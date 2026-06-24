// ddb-mapper.ts
//
// Pure mapper from a D&D Beyond character JSON (as returned by ddb-bridge's
// POST /proxy/character) into a Foundry v13 dnd5e actor payload.
//
// Why a pure function: keeps the mapping logic unit-testable, separated from
// the Foundry Document API calls (Actor.create, createEmbeddedDocuments) that
// live in data-access.ts. The caller passes in pre-resolved compendium packs
// and any helper closures (getInitialValue, slugify) needed to seed defaults.
//
// Output shape (see FoundryDataAccess.importDDBCharacter in data-access.ts):
//   {
//     name: string,
//     type: 'character',
//     img: string,
//     system: { ...overrides on top of CharacterData.schema.getInitialValue() },
//     items: Array<{ name, type, img?, system }>  // embedded items
//   }

// ----------------------------------------------------------------------------
// Lookup tables
// ----------------------------------------------------------------------------

// DDB alignmentId → Foundry alignment key
const ALIGNMENT_BY_ID: Record<number, string> = {
  1: 'lg',
  2: 'ng',
  3: 'cg',
  4: 'ln',
  5: 'tn',
  6: 'cn',
  7: 'le',
  8: 'ne',
  9: 'ce',
};

// DDB stat id (1-6) → Foundry ability key
const STAT_ID_TO_ABILITY: Record<number, string> = {
  1: 'str',
  2: 'dex',
  3: 'con',
  4: 'int',
  5: 'wis',
  6: 'cha',
};

// DDB ability-score modifier subType → Foundry ability key
const STAT_MOD_TO_ABILITY: Record<string, string> = {
  'strength-score': 'str',
  'dexterity-score': 'dex',
  'constitution-score': 'con',
  'intelligence-score': 'int',
  'wisdom-score': 'wis',
  'charisma-score': 'cha',
};

// DDB saving-throws subType → Foundry ability key
const SAVE_MOD_TO_ABILITY: Record<string, string> = {
  'strength-saving-throws': 'str',
  'dexterity-saving-throws': 'dex',
  'constitution-saving-throws': 'con',
  'intelligence-saving-throws': 'int',
  'wisdom-saving-throws': 'wis',
  'charisma-saving-throws': 'cha',
};

// DDB skill subType → Foundry skill key (system.skills.<key>)
const SKILL_MOD_TO_SKILL: Record<string, string> = {
  acrobatics: 'acr',
  'animal-handling': 'ani',
  arcana: 'arc',
  athletics: 'ath',
  deception: 'dec',
  history: 'his',
  insight: 'ins',
  intimidation: 'itm',
  investigation: 'inv',
  medicine: 'med',
  nature: 'nat',
  perception: 'prc',
  performance: 'prf',
  persuasion: 'per',
  religion: 'rel',
  'sleight-of-hand': 'slt',
  stealth: 'ste',
  survival: 'sur',
};

// DDB inventory filterType → Foundry item type
const FILTER_TYPE_TO_ITEM_TYPE: Record<string, string> = {
  Weapon: 'weapon',
  Armor: 'equipment',
  Shield: 'equipment',
  'Wondrous item': 'equipment',
  'Wondrous Item': 'equipment',
  'Adventuring gear': 'equipment',
  Consumable: 'consumable',
  Tool: 'tool',
  'Heavy Armor': 'equipment',
  'Medium Armor': 'equipment',
  'Light Armor': 'equipment',
};

// Race size keyword → Foundry size key
const SIZE_FROM_TEXT: Record<string, string> = {
  Tiny: 'tiny',
  Small: 'sm',
  Medium: 'med',
  Large: 'lg',
  Huge: 'huge',
  Gargantuan: 'grg',
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function modFor(abilityScore: number): number {
  return Math.floor((abilityScore - 10) / 2);
}

function sumStatBonuses(
  modifiers: Record<string, Array<{ type?: string; subType?: string; value?: number }>>,
  abilityKey: string
): number {
  let total = 0;
  for (const group of Object.values(modifiers || {})) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      if (
        (m.type === 'bonus' || m.type === 'override') &&
        STAT_MOD_TO_ABILITY[m.subType ?? ''] === abilityKey
      ) {
        total += m.value ?? 0;
      }
    }
  }
  return total;
}

function collectSaveProfs(
  modifiers: Record<string, Array<{ type?: string; subType?: string }>>
): Record<string, { proficient: boolean }> {
  const out: Record<string, { proficient: boolean }> = {};
  for (const group of Object.values(modifiers || {})) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      const ab = SAVE_MOD_TO_ABILITY[m.subType ?? ''];
      if (ab && m.type === 'proficiency') out[ab] = { proficient: true };
    }
  }
  return out;
}

function collectSkillProfs(
  modifiers: Record<string, Array<{ type?: string; subType?: string }>>
): Record<string, { value: number; proficient?: boolean }> {
  const out: Record<string, { value: number; proficient?: boolean }> = {};
  for (const group of Object.values(modifiers || {})) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      const skillKey = SKILL_MOD_TO_SKILL[m.subType ?? ''];
      if (skillKey && m.type === 'proficiency') {
        // ddb doesn't give us a numeric bonus here, but proficiency is the
        // relevant signal. Use value 1 for proficient, 2 for expertise.
        out[skillKey] = { value: 1, proficient: true };
      }
      if (skillKey && m.type === 'expertise') {
        out[skillKey] = { value: 2, proficient: true };
      }
    }
  }
  return out;
}

function sumClasses(classes: any[]): number {
  let total = 0;
  for (const c of classes || []) total += c?.level ?? 0;
  return total;
}

function profBonusFor(level: number): number {
  return Math.ceil(level / 4) + 1;
}

function getWalkSpeed(
  modifiers: Record<string, Array<{ subType?: string; value?: number }>>
): number {
  for (const group of Object.values(modifiers || {})) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      if (m.subType === 'speed-walk') return m.value ?? 30;
    }
  }
  return 30;
}

function sizeFromRaceTraits(race: any): string {
  for (const t of race?.racialTraits ?? []) {
    const name = t?.definition?.name ?? '';
    const match = Object.keys(SIZE_FROM_TEXT).find(k =>
      name.toLowerCase().includes(k.toLowerCase())
    );
    if (match) return SIZE_FROM_TEXT[match];
  }
  return 'med';
}

function languagesFromRaceTraits(race: any): string[] {
  for (const t of race?.racialTraits ?? []) {
    const name = t?.definition?.name ?? '';
    if (name.toLowerCase() !== 'languages') continue;
    const desc: string = t?.definition?.description ?? '';
    // Strip HTML, take after "Languages:" if present
    const text = desc.replace(/<[^>]+>/g, ' ');
    const after = text.split(/languages?[:\s]/i)[1] || text;
    // Heuristic: split on common list separators, drop empties
    return after
      .split(/[,;]|\band\b/)
      .map((s: string) => s.trim())
      .filter((s: string) => s && s.length < 40)
      .slice(0, 8);
  }
  return [];
}

function bestPortraitUrl(decorations: any): string {
  const url: string = decorations?.avatarUrl ?? '';
  // Bump to a higher resolution for the token portrait.
  return url.replace(/width=\d+/, 'width=350').replace(/height=\d+/, 'height=350');
}

// AC computation: 10 + DEX mod + best worn armor's armorClass + shield's armorClass.
// Mike Hunt has Chain Mail (AC 16) + Shield (+2). DEX 8 → mod -1. Expected: 10 - 1 + 6 + 2 = 17.
function computeFlatAC(dexMod: number, inventory: any[]): number {
  let armorBonus = 0;
  let shieldBonus = 0;
  for (const it of inventory || []) {
    const def = it?.definition;
    if (!def) continue;
    if (def.filterType === 'Shield' || def.type === 'Shield') {
      if (it.equipped !== false) shieldBonus += def.armorClass ?? 0;
    } else if (
      def.filterType === 'Armor' ||
      def.type === 'Heavy Armor' ||
      def.type === 'Medium Armor' ||
      def.type === 'Light Armor'
    ) {
      if (it.equipped !== false) armorBonus = Math.max(armorBonus, def.armorClass ?? 0);
    }
  }
  return 10 + dexMod + armorBonus + shieldBonus;
}

// ----------------------------------------------------------------------------
// Public mapper
// ----------------------------------------------------------------------------

export interface DdbMapperPacks {
  items: any; // game.packs.get('dnd5e.items')
  spells: any; // game.packs.get('dnd5e.spells')
  classfeatures: any; // game.packs.get('dnd5e.classfeatures')
  feats: any; // game.packs.get('dnd5e.feats')
  races: any; // game.packs.get('dnd5e.races')
  backgrounds: any; // game.packs.get('dnd5e.backgrounds')
  classes: any; // game.packs.get('dnd5e.classes')
}

export interface DdbMapperHelpers {
  getInitialSystem: () => any; // game.dnd5e.dataModels.actor.CharacterData.schema.getInitialValue
  getItemSystem: (type: string) => any; // game.dnd5e.dataModels.item.<Type>Data.schema.getInitialValue
  imgFor: (pack: string, name: string) => string; // best-effort icon fallback
}

export interface DdbActorPayload {
  name: string;
  type: 'character';
  img: string;
  system: any;
  items: Array<{ name: string; type: string; img?: string; system: any; _packSource?: string }>;
}

export function mapDdbToActor(
  ddb: any,
  packs: DdbMapperPacks,
  helpers: DdbMapperHelpers
): DdbActorPayload {
  const c = ddb.character ?? ddb; // tolerate either { character } or flat shape

  const system = helpers.getInitialSystem();

  // ── Ability scores (base + bonuses from race/feat/item modifiers) ──
  const allMods: Record<string, any[]> = {
    race: c.modifiers?.race ?? [],
    class: c.modifiers?.class ?? [],
    background: c.modifiers?.background ?? [],
    item: c.modifiers?.item ?? [],
    feat: c.modifiers?.feat ?? [],
  };
  for (const stat of c.stats ?? []) {
    const ab = STAT_ID_TO_ABILITY[stat.id];
    if (!ab) continue;
    const base = stat.value ?? 10;
    const bonus = sumStatBonuses(allMods, ab);
    system.abilities[ab].value = base + bonus;
  }

  // ── Saves ──
  const saveProfs = collectSaveProfs(allMods);
  for (const [ab, v] of Object.entries(saveProfs)) {
    system.abilities[ab].proficient = v.proficient;
  }

  // ── Skills ──
  const skillProfs = collectSkillProfs(allMods);
  for (const [key, v] of Object.entries(skillProfs)) {
    if (system.skills?.[key]) {
      system.skills[key].value = v.value;
      if (v.proficient) system.skills[key].proficient = true;
    }
  }

  // ── HP ──
  const baseHp = (c.baseHitPoints ?? 0) + (c.bonusHitPoints ?? 0);
  const overrideHp = c.overrideHitPoints;
  system.attributes.hp.max = overrideHp ?? baseHp;
  system.attributes.hp.value = Math.max(0, system.attributes.hp.max - (c.removedHitPoints ?? 0));
  system.attributes.hp.temp = c.temporaryHitPoints ?? 0;
  system.attributes.hp.bonuses.level = 0;
  system.attributes.hp.bonuses.overall = 0;

  // ── AC (flat override, since we can't auto-equip from inventory in MVP) ──
  const dexMod = modFor(system.abilities.dex.value);
  const flatAc = computeFlatAC(dexMod, c.inventory ?? []);
  system.attributes.ac.flat = flatAc;
  system.attributes.ac.calcMode = 'flat';

  // ── Prof bonus + level ──
  const totalLevel = sumClasses(c.classes ?? []);
  system.attributes.prof = profBonusFor(totalLevel);
  system.details.level = totalLevel;
  if (c.classes?.[0]?.definition?.name) {
    system.details.class = c.classes[0].definition.name;
  }
  if (c.race?.fullName) system.details.race = c.race.fullName;
  if (c.background?.definition?.name) system.details.background = c.background.definition.name;
  if (c.alignmentId && ALIGNMENT_BY_ID[c.alignmentId]) {
    system.details.alignment = ALIGNMENT_BY_ID[c.alignmentId];
  }
  if (typeof c.currentXp === 'number') system.details.xp.value = c.currentXp;

  // ── Currency ──
  if (c.currencies) {
    system.attributes.currency = {
      pp: c.currencies.pp ?? 0,
      gp: c.currencies.gp ?? 0,
      ep: c.currencies.ep ?? 0,
      sp: c.currencies.sp ?? 0,
      cp: c.currencies.cp ?? 0,
    };
  }

  // ── Movement, size, languages ──
  if (system.attributes.movement?.walk !== undefined) {
    system.attributes.movement.walk = getWalkSpeed(allMods);
  }
  if (c.race) {
    system.traits.size = sizeFromRaceTraits(c.race);
    const langs = languagesFromRaceTraits(c.race);
    if (langs.length) system.traits.languages.value = langs;
  }

  // ── Build items list ──
  const items: DdbActorPayload['items'] = [];

  // class (single class for MVP)
  if (c.classes?.[0]?.definition?.name) {
    items.push({
      name: c.classes[0].definition.name,
      type: 'class',
      system: helpers.getItemSystem('class'),
    });
  }

  // race
  if (c.race?.fullName) {
    items.push({
      name: c.race.fullName,
      type: 'race',
      system: helpers.getItemSystem('race'),
    });
  }

  // background
  if (c.background?.definition?.name) {
    items.push({
      name: c.background.definition.name,
      type: 'background',
      system: helpers.getItemSystem('background'),
    });
  }

  // inventory — resolve each item by name against dnd5e.items SRD
  for (const inv of c.inventory ?? []) {
    const def = inv.definition ?? {};
    const itemType = FILTER_TYPE_TO_ITEM_TYPE[def.filterType ?? def.type ?? ''] ?? 'loot';
    const name: string = def.name ?? 'Unknown';
    const packMatch = packs.items?.index?.getName?.(name);
    if (packMatch) {
      // ponytail: defer resolve to caller (data-access) — pass pack/source through
      items.push({
        name,
        type: itemType,
        system: helpers.getItemSystem(itemType),
        _packSource: `Compendium.dnd5e.items.${packMatch._id}`,
      });
    } else {
      items.push({
        name,
        type: itemType,
        img: helpers.imgFor('item', name),
        system: helpers.getItemSystem(itemType),
      });
    }
  }

  // spells — for each classSpells entry, add prepared spells by name
  for (const classSpells of c.classSpells ?? []) {
    for (const sp of classSpells.spells ?? []) {
      const def = sp.definition ?? {};
      if (!def.name) continue;
      const match = packs.spells?.index?.getName?.(def.name);
      if (!match) continue; // stub creation for missing SRD spells is too noisy at L1
      items.push({
        name: def.name,
        type: 'spell',
        system: helpers.getItemSystem('spell'),
        _packSource: `Compendium.dnd5e.spells.${match._id}`,
      });
    }
  }

  // class features (paladin "Spellcasting", "Lay On Hands", etc.) — best-effort
  for (const actionGroup of Object.values(c.actions ?? {}) as Array<Array<any>>) {
    if (!Array.isArray(actionGroup)) continue;
    for (const action of actionGroup) {
      const name = action.name ?? action.definition?.name;
      if (!name) continue;
      const match =
        packs.classfeatures?.index?.getName?.(name) ?? packs.feats?.index?.getName?.(name);
      const pack = match
        ? packs.classfeatures?.index?.getName?.(name)
          ? 'classfeatures'
          : 'feats'
        : null;
      if (match && pack) {
        items.push({
          name,
          type: 'feat',
          system: helpers.getItemSystem('feat'),
          _packSource: `Compendium.dnd5e.${pack}.${match._id}`,
        });
      }
    }
  }

  return {
    name: c.name ?? 'Unknown Character',
    type: 'character',
    img: bestPortraitUrl(c.decorations),
    system,
    items,
  };
}

// Helper for callers: resolve a pack-sourced item to its full document data.
export async function resolvePackSource(pack: any, source: string): Promise<any> {
  // source format: "Compendium.dnd5e.items.<id>" or just "<id>"
  const parts = source.split('.');
  const docId = parts[parts.length - 1];
  const doc = await pack.getDocument(docId);
  return doc?.toObject?.() ?? null;
}
