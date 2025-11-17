const MODULE_ID = "local-token-overrides";
const SETTING = "actorOverides";

/* -------------------------------------------- */
/* Cached state                                 */
/* -------------------------------------------- */

// Cache the overrides object and its keys so we don't recompute or keep calling game.settings.get
let _overridesCache = {};

// Texture cache so we don't re-run loadTexture on the same path repeatedly.
// (Map is appropriate here; WeakMap only accepts object keys, not strings.)
const _textureCache = new Map();

/**
 * Load a texture with caching.
 * Foundry already caches at the baseTexture level, but this avoids redundant loadTexture calls.
 */
async function getCachedTexture(path) {
  if (!path) return null;

  if (_textureCache.has(path)) {
    return _textureCache.get(path);
  }

  const tex = await foundry.canvas.loadTexture(path);
  _textureCache.set(path, tex);
  return tex;
}

/**
 * Sync cache from settings (used at startup).
 */
function syncOverridesCacheFromSettings() {
  const stored = game.settings.get(MODULE_ID, SETTING) ?? {};
  _overridesCache = stored;
}

/**
 * Central setter to update both settings and in-memory cache.
 */
async function setAllOverrides(newOverrides) {
  const cleaned = newOverrides ?? {};
  _overridesCache = cleaned;
  await game.settings.set(MODULE_ID, SETTING, cleaned);
}

/* -------------------------------------------- */
/* Helper accessors                             */
/* -------------------------------------------- */

function getOverrides() {
  return _overridesCache;
}

function getOverrideKeys() {
  return _overrideKeysCache;
}

function hasAnyOverrides() {
  return Object.keys(_overridesCache).length > 0;
}

function actorHasOverride(actorId) {
  if (!actorId) return false;
  return Object.prototype.hasOwnProperty.call(_overridesCache, actorId);
}

async function setActorOverride(actorId, img) {
  const overrides = foundry.utils.duplicate(_overridesCache);
  overrides[actorId] = img;
  await setAllOverrides(overrides);
}

async function clearActorOverride(actorId) {
  if (!actorHasOverride(actorId)) return;
  const overrides = foundry.utils.duplicate(_overridesCache);
  delete overrides[actorId];
  await setAllOverrides(overrides);
}

function getActorOverridePath(actorId) {
  if (!actorHasOverride(actorId)) return null;
  const overrides = getOverrides();
  return overrides[actorId] || null;
}

/**
 * Apply a local override (if any) to this Token placeable (per-actor).
 */
async function applyLocalOverride(token) {
  if (!token?.document?.actor) return;

  const actorId = token.document.actor.id;
  if (!actorHasOverride(actorId)) return;

  const overrides = getOverrides();
  const newImg = overrides[actorId];
  if (!newImg) return;

  let tex;
  try {
    tex = await getCachedTexture(newImg);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to load texture: ${newImg}`, err);
    return;
  }

  const sprite = token.mesh;
  if (!sprite || !tex) return;

  sprite.texture = tex;
  sprite.texture.baseTexture.update?.();
}

/* -------------------------------------------- */
/* Hooks                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  // Client-only actor override map
  game.settings.register(MODULE_ID, SETTING, {
    name: "Local Actor Token Overrides",
    hint: "Per-client map of actor IDs to alternative token image paths.",
    scope: "user",
    config: false,
    type: Object,
    default: {}
  });
  // Prime the cache once at startup
  syncOverridesCacheFromSettings();
});


Hooks.on("canvasReady", () => {
  if (!canvas?.tokens || !hasAnyOverrides()) return;

  const overrides = getOverrides();

  for (const t of canvas.tokens.placeables) {
    const actorId = t.document.actor?.id;
    if (actorId && overrides[actorId]) {
      applyLocalOverride(t);
    }
  }
});


Hooks.on("refreshToken", (token, changes) => {
  if (!canvas?.tokens || !hasAnyOverrides()) return;

  const actorId = token?.document?.actor?.id;
  if (!actorHasOverride(actorId)) return;
  applyLocalOverride(token);
});


Hooks.on("createToken", (tokenDoc) => {
  if (!canvas?.tokens || !hasAnyOverrides()) return;

  const actorId = tokenDoc.actor?.id;
  if (!actorHasOverride(actorId)) return;

  const token = canvas.tokens.get(tokenDoc.id);
  if (token) applyLocalOverride(token);
});


Hooks.on("updateToken", (tokenDoc) => {
  if (!canvas?.tokens || !hasAnyOverrides()) return;

  const actorId = tokenDoc.actor?.id;
  if (!actorHasOverride(actorId)) return;

  const token = canvas.tokens.get(tokenDoc.id);
  if (token) applyLocalOverride(token);
});


Hooks.on("renderChatMessageHTML", (message, html, data) => {
  if (!hasAnyOverrides()) return;

  // 1) Find the actor for this message
  // PF2e and newer cores usually set message.actor; getActor() is a safe fallback.
  const actor =
    message.actor ??
    (typeof message.getActor === "function" ? message.getActor() : null) ??
    (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);

  if (!actor) return;

  // 2) Only do anything if this actor has a local override
  const overridePath = getActorOverridePath(actor.id);
  if (!overridePath) return;

  // We have to update the token document source, as that is what ChatMessagePF2E
  // uses to add an image to chat
  const sceneId = message.speaker.scene ?? "";
  const tokenId = message.speaker.token ?? "";
  const token = game.scenes.get(sceneId)?.tokens.get(tokenId) ?? null;

  if (token) {
    token.texture.src = overridePath;
  } else if (actor.prototypeToken?.texture?.src) {
    actor.prototypeToken.texture.src = overridePath;
  }
});


// Replace actor images in the combat tracker (locally) based on overrides
Hooks.on("renderCombatTracker", (app, html, data) => {
  if (!hasAnyOverrides()) return;

  const combat = data.combat;
  if (!combat) return;

  // v12/v13: combatants is usually a Collection; .contents gets the array
  const combatants = combat.combatants?.contents ?? combat.combatants ?? [];
  const overrides = getOverrides();

  for (const c of combatants) {
    const actorId = c.actorId;
    const imgPath = overrides[actorId];
    if (!imgPath) continue;

    // Each <li> has data-combatant-id="<combatant.id>"
    const img = html.querySelector(`li.combatant[data-combatant-id="${c.id}"] > img.token-image`);

    if (img) img.src = imgPath;
  }
});


// Override actor images in the Actors sidebar, locally
Hooks.on("renderActorDirectory", (app, html, data) => {
  if (!hasAnyOverrides()) return;

  const overrides = getOverrides();

  Object.keys(overrides).forEach(function(actorId)  {
    const img = html.querySelector(`li.directory-item.document[data-entry-id="${actorId}"] > img.thumbnail`)
    if (img) img.src = overrides[actorId];
  });
  
});


Hooks.on("renderActorSheetPF2e", (sheet, html, data) => {
  if (!hasAnyOverrides()) return;

  const actor = sheet.actor;
  if (!actor) return;

  if (actor.type === "party") {
    const overrides = getOverrides();

    if (html.length > 0) {
      Object.keys(overrides).forEach(function(actorId) {
        const img = html[0].querySelector(`section.member[data-actor-uuid="Actor.${actorId}"] > div.portrait img`)
        if (img) img.src = overrides[actorId];
      });
    }
    
    return;
  }

  const overridePath = getActorOverridePath(actor.id);
  if (!overridePath) return;

  if (html.length > 0) {
    const img = html[0].querySelector("img.profile-img");
    if (img) img.src = overridePath;
  }
});

/* -------------------------------------------- */
/* Expose helpers for macros                    */
/* -------------------------------------------- */

globalThis[MODULE_ID] = {
  applyLocalOverride,
  setActorOverride,
  clearActorOverride,
  getOverrides,
  getOverrideKeys,
  hasAnyOverrides,
  actorHasOverride
};
