import { DicePoolFFG, RollFFG } from "./dice-pool-ffg.js";
import PopoutEditor from "./popout-editor.js";

/**
 * Extend the base Combat entity.
 * @extends {Combat}
 */
export class CombatFFG extends Combat {
  /** @override */
  _getInitiativeRoll(combatant, formula) {
    const cData = duplicate(combatant.actor.system);

    if (combatant.actor.type === "vehicle") {
      return new RollFFG("0");
    }

    if (formula === "Vigilance") {
      formula = _getInitiativeFormula(cData.skills.Vigilance, parseInt(cData.characteristics.Willpower.value));
    } else if (formula === "Cool") {
      formula = _getInitiativeFormula(cData.skills.Cool, parseInt(cData.characteristics.Presence.value));
    }

    const rollData = combatant.actor ? combatant.actor.getRollData() : {};

    let roll = new RollFFG(formula, rollData).roll();

    const total = roll.ffg.success + roll.ffg.advantage * 0.01;
    roll._result = total;
    roll._total = total;

    return roll;
  }

  /** @override */
  _getInitiativeFormula(combatant) {
    return CONFIG.Combat.initiative.formula || game.system.initiative;
  }

  /** @override */
  async rollInitiative(ids, { formula = null, updateTurn = true, messageOptions = {} } = {}) {
    let initiative = this;

    let promise = new Promise(async function (resolve, reject) {
      const id = randomID();

      let whosInitiative = initiative.combatant?.name;
      let dicePools = [];
      let vigilanceDicePool = new DicePoolFFG({});
      let coolDicePool = new DicePoolFFG({});
      let addDicePool = new DicePoolFFG({});

      const defaultInitiativeFormula = formula || initiative._getInitiativeFormula();
      if (Array.isArray(ids) && ids.length > 1) {
        whosInitiative = "Multiple Combatants";
      } else {
        // Make sure we are dealing with an array of ids
        ids = typeof ids === "string" ? [ids] : ids;
        const c = initiative.getCombatantByToken(
          initiative.combatants.map(combatant => combatant)
            .filter(combatantData => combatantData._id == ids[0])[0]
            .tokenId);
        const data = c.actor.system;
        whosInitiative = c.actor.name;

        vigilanceDicePool = _buildInitiativePool(data, "Vigilance");
        coolDicePool = _buildInitiativePool(data, "Cool");

        const initSkills = Object.keys(data.skills).filter((skill) => data.skills[skill].useForInitiative);

        initSkills.forEach((skill) => {
          if (dicePools.find((p) => p.name === skill)) return;

          const skillPool = _buildInitiativePool(data, skill);
          skillPool.label = data.skills[skill].label;
          skillPool.name = skill;
          dicePools.push(skillPool);
        });
      }

      if (dicePools.findIndex((p) => p.name === "Vigilance") < 0) {
        vigilanceDicePool.label = "SWFFG.SkillsNameVigilance";
        vigilanceDicePool.name = "Vigilance";
        dicePools.push(vigilanceDicePool);
      }
      if (dicePools.findIndex((p) => p.name === "Cool") < 0) {
        coolDicePool.label = "SWFFG.SkillsNameCool";
        coolDicePool.name = "Cool";
        dicePools.push(coolDicePool);
      }

      const title = game.i18n.localize("SWFFG.InitiativeRoll") + ` ${whosInitiative}...`;
      const content = await renderTemplate("systems/starwarsffg/templates/dialogs/ffg-initiative.html", {
        id,
        dicePools,
        addDicePool,
        defaultInitiativeFormula,
      });

      new Dialog({
        title,
        content,
        buttons: {
          one: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SWFFG.InitiativeRoll"),
            callback: async () => {
              const container = document.getElementById(id);
              const currentId = initiative.combatant?.id;

              const baseFormulaType = container.querySelector('input[name="skill"]:checked').value;

              // Iterate over Combatants, performing an initiative roll for each
              const [updates, messages] = await ids.reduce(
                async (results, id, i) => {
                  let [updates, messages] = await results;
                  // Get Combatant data
                  const c = initiative.getCombatantByToken(
                    initiative.combatants.map(combatant => combatant)
                      .filter(combatantData => combatantData._id == id)[0]
                      .tokenId);
                  if (!c || !c.isOwner) return resolve(results);

                  // Detemine Formula
                  let pool = _buildInitiativePool(c.actor.system, baseFormulaType);

                  const addPool = DicePoolFFG.fromContainer(container.querySelector(`.addDicePool`));
                  pool.success += +addPool.success;
                  pool.advantage += +addPool.advantage;
                  pool.failure += +addPool.failure;
                  pool.threat += +addPool.threat;
                  pool.boost += +addPool.boost;
                  pool.setback += +addPool.setback;

                  const rollData = c.actor ? c.actor.getRollData() : {};
                  let roll = new RollFFG(pool.renderDiceExpression(), rollData, { success: pool.success, advantage: pool.advantage, failure: pool.failure, threat: pool.threat }).roll();
                  const total = roll.ffg.success + roll.ffg.advantage * 0.01;
                  roll._result = total;
                  roll._total = total;

                  // Roll initiative
                  updates.push({ _id: id, initiative: roll.total });

                  // Determine the roll mode
                  let rollMode = messageOptions.rollMode || game.settings.get("core", "rollMode");
                  if ((c.token.hidden || c.hidden) && rollMode === "roll") rollMode = "gmroll";

                  // Construct chat message data
                  let messageData = mergeObject(
                    {
                      speaker: {
                        scene: canvas.scene.id,
                        actor: c.actor ? c.actor.id : null,
                        token: c.token.id,
                        alias: c.token.name,
                      },
                      flavor: `${c.token.name} ${game.i18n.localize("SWFFG.InitiativeRoll")} (${game.i18n.localize(`SWFFG.SkillsName${baseFormulaType.replace(/[: ]/g, "")}`)})`,
                      flags: { "core.initiativeRoll": true },
                    },
                    messageOptions
                  );
                  const chatData = await roll.toMessage(messageData, { create: false, rollMode });

                  // Play 1 sound for the whole rolled set
                  if (i > 0) chatData.sound = null;
                  messages.push(chatData);

                  // Return the Roll and the chat data
                  return results;
                },
                [[], []]
              );
              if (!updates.length) return initiative;

              // Update multiple combatants
              await initiative.updateEmbeddedDocuments("Combatant", updates);

              // Ensure the turn order remains with the same combatant if there was one active
              if (updateTurn && !!currentId) {
                await initiative.update({ turn: initiative.turns.findIndex((t) => t.id === currentId) });
              }

              // Create multiple chat messages
              await CONFIG.ChatMessage.documentClass.create(messages);

              resolve(initiative);
            },
          },
          two: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SWFFG.Cancel"),
          },
        },
      }).render(true);
    });

    return await promise;
  }


  /**
   * @override
   * Advance the combat to the next round, unclaiming all slots
   * @returns {Promise<Combat>}
   */
  async nextRound() {
    return super.nextRound().then(() => this.combatants.forEach(c => {
      c.unclaimSlot();
      c.markUnacted();
    }));
  }

  /**
   * @override
   * Rewind the combat to the previous round, not implemented for Star Wars
   * @returns {Promise<Combat>}
   */
  async previousRound() {
    return Promise.resolve();
  }
}

function _getInitiativeFormula(skill, ability) {
  const dicePool = new DicePoolFFG({
    ability: ability,
    boost: parseInt(skill.boost),
    setback: parseInt(skill.setback),
    force: parseInt(skill.force),
  });
  dicePool.upgrade(parseInt(skill.rank));
  return dicePool.renderDiceExpression();
}

function _buildInitiativePool(data, skill) {
  const pool = new DicePoolFFG({
    ability: Math.max(data.characteristics[data.skills[skill].characteristic].value, data.skills[skill].rank),
    boost: data.skills[skill].boost,
    advantage: data.skills[skill].advantage,
    success: data.skills[skill].success,
  });
  pool.upgrade(Math.min(data.characteristics[data.skills[skill].characteristic].value, data.skills[skill].rank));

  return pool;
}

function claimSlot(combat, slotId, claimerId) {
  const slot = combat.combatants.get(slotId);
  const claimer = combat.combatants.get(claimerId);
  const claimedBy = slot.getClaimedId();
  if (claimedBy) {
    // If slot was claimed, remove mark from previous claimer
    combat.combatants.get(claimedBy).markUnacted();
  }
  // Claim slot with selected combatant, mark them as having acted, then close selection
  slot.claimSlot(claimer.id);
  claimer.markActed();
}

Hooks.once("init", async function () {
  game.socket.on("system.starwarsffg", async (msg) => {
    if(msg.claimSlot) {
      claimSlot(game.combats.get(msg.combatId), msg.slotId, msg.claimerId);
    }
  });
});

export class CombatantFFG extends Combatant {
  claimSlot(slotClaimedId) {
    this.setFlag('starwarsffg', 'slotClaimedId', slotClaimedId);
  }

  unclaimSlot() {
    this.unsetFlag('starwarsffg', 'slotClaimedId');
  }

  getClaimedId() {
    return this.getFlag('starwarsffg', 'slotClaimedId');
  }

  markActed() {
    this.setFlag('starwarsffg', 'hasActed', true);
  }
  markUnacted() {
    this.setFlag('starwarsffg', 'hasActed', false);
  }
  hasActed() {
    return this.getFlag('starwarsffg', 'hasActed');
  }
}


export class CombatTrackerFFG extends CombatTracker {
  /** @override */
  async getData(options = {}) {
    const data = await super.getData(options);
    if (!data.combat?.started) {
      //special logic only happens after combat starts
      return data;
    }

    data.turns = data.turns.map(turn => {
      let displayData;
      const slot = data.combat.combatants.get(turn.id);
      const disposition = this._getDisposition(slot);
      const claimedBy = slot.getClaimedId();
      if (claimedBy) {
        // All activations that have happened have their name and image put in
        const claimer = data.turns.find(cTurn => cTurn.id === claimedBy);
        displayData = {
          name: claimer.name,
          img: claimer.img,
          effects: claimer.effects,
        }
        //        owner: claimer.owner,
      } else {
        // The others are empty slots
        displayData = this._getSlotData(disposition);
      }

      return {
        ...displayData,
        id: turn.id,
        active: turn.active,
        css: turn.css,
        defeated: false,
        hidden: false,
        initiative: turn.initiative,
        hasRolled: turn.hasRolled,
        canPing: false,
        disposition: disposition,
        owner: true,
      }
    });
    return data;
  }

  _getDisposition(combatant) {
    return combatant?.token?.disposition || -1;
  }

  _getSlotData(disposition) {
    if (disposition === 1) {
      return { img: "systems/starwarsffg/images/dice/starwars/lightside.png", name: "Friendly" };
    }
    else if (disposition === 0) {
      return { img: "systems/starwarsffg/images/mod-all.png", name: "Neutral" };
    }
    else {
      return { img: "systems/starwarsffg/images/dice/starwars/darkside.png", name: "Hostile" };
    }
  }

  /** @override */
  _onCombatantHoverIn(event) {
    event.preventDefault();
    if (!canvas.ready)
      return;
    const li = $(event.currentTarget);
    const slot = this.viewed.combatants.get(li.data().combatantId);
    let combatant;
    if(li.hasClass('combatant-choice-option')){
      // hover over for choice selection
      combatant = slot;
    } else {
      // hover over for claimed slots
      combatant = this.viewed.combatants.get(slot.getClaimedId());
    }
    if (!combatant)
      return;
    const token = combatant.token?.object;
    if (token?.isVisible) {
      if (!token.controlled) token._onHoverIn(event);
      this._highlighted = token;
    }
  }

  /** @override */
  async _onCombatantMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();

    const combat = this.viewed;
    const li = $(event.currentTarget);
    const slot = combat.combatants.get(li.data().combatantId);
    if (combat.current.combatantId !== slot.id) {
      // Not the active slot, exit early
      return;
    }
    const existingSelection = li.children('.combatant-choice');
    if (existingSelection.length) {
      // List is already folded out, remove it
      existingSelection.remove();
      return;
    }

    /* Function to claim slot directly or send socket message */
    function pickCombatant(combatantId) {
      if (game.user.isGM) {
        claimSlot(combat, slot.id, combatantId);
      }
      else {
        // Non-GMs will send a socket message
        game.socket.emit('system.starwarsffg', {
          claimSlot: true,
          combatId: combat.id,
          slotId: slot.id,
          claimerId: combatantId,
        });
      }
    }

    // Find all combatants valid to be picked here
    const slotDisposition = this._getDisposition(slot);
    const availableCombatants = combat.combatants.filter(
      c => this._getDisposition(c) === slotDisposition && !c.hasActed() && c.testUserPermission(game.user)
    );

    if(availableCombatants.length <= 0) {
      // No tokens to choose from, do nothing
      return;
    }

    if(availableCombatants.length == 1 && !game.user.isGM) {
      // For players, if they have a single option, automatically choose it
      pickCombatant(availableCombatants[0].id);
      return;
    }

    // Build and append an list of options
    let choiceButtons = [];
    for (let combatant of availableCombatants) {
      const choiceOption = $(`
      <li class="combatant-choice-option flexrow" data-combatant-id="${combatant.id}">
        <img class="token-image" alt="Hostile" src="${await this._getCombatantThumbnail(combatant)}">
        <div class="token-name flexcol">${combatant.name}</div>
      </li>`);
      choiceOption.click(async ev => {
        pickCombatant(combatant.id);
        choiceOption.remove();
      });
      // Hover over to highlight token
      choiceOption.hover(this._onCombatantHoverIn.bind(this), this._onCombatantHoverOut.bind(this));
      choiceButtons.push(choiceOption);
    }
    li.append($(`<ol class="combatant-choice"></ol>`).append(choiceButtons));
    return;
  }


  /** @override */
  _getEntryContextOptions() {
    const m = [
      {
        name: 'SWFFG.Combat.DupActivation',
        icon: '<i class="fas fa-clone"></i>',
        callback: (target) => {
          const combat = this.viewed;
          const source = combat.combatants.get($(target).data().combatantId);
          combat.createEmbeddedDocuments("Combatant", [{
            ...source,
          }]);
        }
      }
    ];
    m.push(
      ...super._getEntryContextOptions()
    );
    return m;
  }
}