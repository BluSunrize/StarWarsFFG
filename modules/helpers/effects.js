/**
 * Extend the base ActiveEffect class to implement system-specific logic.
 */
export default class ActiveEffectFFG extends ActiveEffect {

    /**
      * Manage Active Effect instances through the Actor Sheet via effect control buttons.
      * @param {MouseEvent} event      The left-click event on the effect control
      * @param {Actor5e|Item5e} owner  The owning document which manages this effect
      * @returns {Promise|null}        Promise that resolves when the changes are complete.
      */
    static onManageActiveEffect(event, owner) {
        event.preventDefault();
        const a = event.currentTarget;
        const li = a.closest("li");
        const effect = li.dataset.effectId ? owner.effects.get(li.dataset.effectId) : null;
        switch (a.dataset.action) {
            case "create":
                return owner.createEmbeddedDocuments("ActiveEffect", [{
                    label: game.i18n.localize("SWFFG.Effect.New"),
                    icon: "icons/svg/aura.svg",
                    origin: owner.uuid,
                    "duration.rounds": li.dataset.effectType === "temporary" ? 1 : undefined,
                    disabled: li.dataset.effectType === "inactive"
                }]);
            case "edit":
                return effect.sheet.render(true);
            case "delete":
                return effect.delete();
            case "toggle":
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
                type: "temporary",
                label: game.i18n.localize("SWFFG.Effect.Temporary"),
                effects: []
            },
            passive: {
                type: "passive",
                label: game.i18n.localize("SWFFG.Effect.Passive"),
                effects: []
            },
            inactive: {
                type: "inactive",
                label: game.i18n.localize("SWFFG.Effect.Inactive"),
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

    static extendEffectSheet(sheet, html) {
        const flags = sheet.object.flags ?? {};
        const duration_checks = flags[CONFIG.module]?.duration_checks;
        const contents = `
          <hr>
          <div class="form-group">
            <label>Effect Duration (Skillchecks)</label>
            <div class="form-fields">
                <input type="number" name="flags.${CONFIG.module}.duration_checks" value="${duration_checks}">
            </div>
          </div>`;
        html.find('section[data-tab="duration"] div.form-group').last().after(contents);
        if (sheet._tabs[0]?.active == 'duration')
            html.css({ height: "auto" });
    }
}