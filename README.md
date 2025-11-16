# Local Token Overrides

A simple foundry VTT module that allows users to override the image of a actor for themselves only.

## How to use

### Initial Setup

1. Create a script macro, **Set Override**, with the following script:

```javascript
const MODULE_ID = "local-token-overrides";

if (!globalThis[MODULE_ID]) {
  return ui.notifications.error("Local Token Overrides module not loaded.");
}

// Choose token: prefer hovered, else controlled
const token = canvas.tokens.hover ?? canvas.tokens.controlled[0];
if (!token) {
  return ui.notifications.warn("Hover or select a token to override.");
}

const actor = token.document.actor;
if (!actor) {
  return ui.notifications.warn("That token has no actor.");
}

const currentOverrides = globalThis[MODULE_ID].getOverrides();
const current = currentOverrides[actor.id] ?? token.document.texture.src;

// Use a FilePicker so users can browse assets
const fp = new foundry.applications.apps.FilePicker.implementation({
  type: "image",
  current: current || "tokens",
  callback: async (path) => {
    if (!path) return;

    await globalThis[MODULE_ID].setActorOverride(actor.id, path);

    // Apply to all tokens of that actor on this client
    for (const t of canvas.tokens.placeables) {
      if (t.document.actor?.id === actor.id) {
        await globalThis[MODULE_ID].applyLocalOverride(t);
      }
    }

    ui.notifications.info(`Set local override for ${actor.name} to: ${path}`);
  }
});

fp.render(true);
```

2. Create a script macro, **Clear Override**, with the following:

```javascript
const MODULE_ID = "local-token-overrides";

if (!globalThis[MODULE_ID]) {
  return ui.notifications.error("Local Token Overrides module not loaded.");
}

const token = canvas.tokens.hover ?? canvas.tokens.controlled[0];
if (!token) {
  return ui.notifications.warn("Hover or select a token to clear its override.");
}

const actor = token.document.actor;
if (!actor) {
  return ui.notifications.warn("That token has no actor.");
}

const overrides = globalThis[MODULE_ID].getOverrides();
if (!overrides[actor.id]) {
  return ui.notifications.info(`No local override set for ${actor.name}.`);
}

await globalThis[MODULE_ID].clearActorOverride(actor.id);

ui.notifications.info(`Cleared local override for ${actor.name}.`);
```

### Overriding a token

1. Hover over a token of the actor you want to override and activate the **Set Override** macro
2. Select the image you want on the dialog
3. Refresh (F5)

### Clearing overrides

1. Hover over a token of the actor you want to override and activate the **Clear Override** macro
2. Refresh (F5)
