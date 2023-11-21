/**
 * Extend the base ActiveEffect class to implement system-specific logic.
 */
export default class ActiveEffectFFG extends ActiveEffect {

    /** 
     * @override
     * Prepare derived data related to active effect duration
     * @internal
     */
    _prepareDuration() {
        const d = this.duration;
        const durFlags = this.getFlag('starwarsffg', 'duration') ?? {};

        // Duration in skillchecks
        if (Number.isNumeric(durFlags.checks)) {
            return foundry.utils.mergeObject(d, {
                type: "checks",
                duration: durFlags.checks,
                remaining: durFlags.checks,
                label: `${durFlags.checks} ${game.i18n.localize(durFlags.checks === 1 ? 'SWFFG.Effect.Check' : 'SWFFG.Effect.Check')}`
            });
        }
        // Rounds
        if (d.rounds) {
            return foundry.utils.mergeObject(d, {
                type: "rounds",
                duration: d.rounds,
                remaining: d.rounds,
                label: `${d.rounds} ${game.i18n.localize(d.rounds === 1 ? 'COMBAT.Round' : 'COMBAT.Rounds')}`
            });
        }
        // Turns
        if (d.turns) {
            const anchorText = durFlags.turn_anchor === 'turn_start' ? 'SWFFG.Effect.TurnAnchor.Start' : 'SWFFG.Effect.TurnAnchor.End';
            return foundry.utils.mergeObject(d, {
                type: "turns",
                duration: d.turns,
                remaining: d.turns,
                label: `${game.i18n.localize(anchorText)} ${d.turns} ${game.i18n.localize(d.turns === 1 ? 'COMBAT.Round' : 'COMBAT.Rounds')}`
            });
        }

        // No duration
        return foundry.utils.mergeObject(d, {
            type: "none",
            duration: null,
            remaining: null,
            label: game.i18n.localize("None")
        });
    }

    /**
     * Manage Active Effect instances through the Actor Sheet via effect control buttons.
     * @param {MouseEvent} event      The left-click event on the effect control
     * @param {Actor5e|Item5e} owner  The owning document which manages this effect
     * @returns {Promise|null}        Promise that resolves when the changes are complete.
     */
    static onManageActiveEffect(event, owner) {
        event.preventDefault();
        const a = event.currentTarget;
        const li = a.closest('li');
        const effect = li.dataset.effectId ? owner.effects.get(li.dataset.effectId) : null;
        switch (a.dataset.action) {
            case 'create':
                return owner.createEmbeddedDocuments('ActiveEffect', [{
                    label: game.i18n.localize('SWFFG.Effect.New'),
                    icon: 'icons/svg/aura.svg',
                    origin: owner.uuid,
                    'duration.turns': li.dataset.effectType === 'temporary' ? 1 : undefined,
                    'flags.starwarsffg.duration.turn_anchor': 'turn_start',
                    disabled: li.dataset.effectType === "inactive"
                }]);
            case 'edit':
                return effect.sheet.render(true);
            case 'delete':
                return effect.delete();
            case 'toggle':
                return effect.update({ disabled: !effect.disabled });
        }
    }

    /* --------------------------------------------- */

    /**
     * Prepare the data structure for Active Effects which are currently applied to an Actor or Item.
     * @param {ActiveEffect5e[]} effects  The array of Active Effect instances to prepare sheet data for
     * @returns {object}                  Data for rendering
     */
    static prepareActiveEffectCategories(effects) {
        // Define effect header categories
        const categories = {
            temporary: {
                type: 'temporary',
                label: game.i18n.localize('SWFFG.Effect.Temporary'),
                effects: []
            },
            passive: {
                type: 'passive',
                label: game.i18n.localize('SWFFG.Effect.Passive'),
                effects: []
            },
            inactive: {
                type: 'inactive',
                label: game.i18n.localize('SWFFG.Effect.Inactive'),
                effects: []
            },
        };

        // Iterate over active effects, classifying them into categories
        for (let e of effects) {
            e._getSourceName(); // Trigger a lookup for the source name
            if (e.disabled) categories.inactive.effects.push(e);
            else if (e.isTemporary) categories.temporary.effects.push(e);
            else categories.passive.effects.push(e);
        }
        return categories;
    }

    static updateDurationsInCombat(actor, turn_event) {
        for (let effect of actor.effects) {
            const anchor = effect.getFlag('starwarsffg', 'duration.turn_anchor');
            if (effect.duration.turns > 0 && anchor === turn_event) {
                const turnsRemaining = effect.duration.turns - 1;
                if (turnsRemaining <= 0)
                    effect.delete();
                else
                    effect.update({ 'duration.turns': turnsRemaining });
            }
        }
    }

    static async extendEffectSheet(sheet, html) {
        const template = 'systems/starwarsffg/templates/actors/dialogs/ffg-active-effect-duration.html';
        const tabContents = await renderTemplate(template, sheet.object);
        html.find('section[data-tab="duration"]').empty().append(tabContents);
        if (sheet._tabs[0]?.active == 'duration')
            html.css({ height: 'auto' });
    }
}