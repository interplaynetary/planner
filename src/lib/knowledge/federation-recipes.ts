/**
 * Shared federation recipe data — Mediterranean communes + Frontier Tower.
 * Imported by both the federation page and the recipes browser.
 */
import { RecipeStore } from './recipes';
import type { EconomicResource } from '../schemas';

// =============================================================================
// SPEC DISPLAY NAMES
// =============================================================================

export const SPEC_NAMES: Record<string, string> = {
  wheat: "Wheat",
  dairy: "Dairy",
  tools: "Tools",
  goods: "Goods",
  "olive-oil": "Olive Oil",
  citrus: "Citrus",
  flour: "Flour",
  bread: "Bread",
  fish: "Fish",
  salt: "Salt",
  "raw-flour": "Raw Flour",
  metal: "Iron Metal",
  ore: "Iron Ore",
  dough: "Dough",
  brine: "Brine",
  // Frontier Tower
  compute: "GPU Compute",
  electronics: "Electronics",
  "3d-filament": "3D Filament",
  "fabricated-parts": "Fabricated Parts",
  prototypes: "Prototypes",
  "lab-reagents": "Lab Reagents",
  "bio-samples": "Bio Samples",
  supplements: "Supplements",
  "media-content": "Media Content",
  meals: "Meals",
  "fitness-sessions": "Fitness Sessions",
  "ai-models": "AI Models",
  "node-infra": "Node Infra",
  "wellness-pgm": "Wellness Programs",
  "coffee-beans": "Coffee Beans",
  coffee: "Coffee",
  "event-tickets": "Event Tickets",
  consulting: "Consulting",
  ventures: "Ventures",
};

// =============================================================================
// FEDERATION INVENTORY — on-hand resources grouped by scope
// =============================================================================

export function buildFederationInventory(): Map<string, EconomicResource[]> {
  return new Map<string, EconomicResource[]>([
    ["commune-grain", [{ id: "res-grain-wheat", name: "Wheat Reserve", conformsTo: "wheat",
      accountingQuantity: { hasNumericalValue: 80, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 80, hasUnit: "kg" },
      primaryAccountable: "commune-grain", custodianScope: "commune-grain" }]],
    ["commune-dairy", [{ id: "res-dairy-dairy", name: "Dairy Stock", conformsTo: "dairy",
      accountingQuantity: { hasNumericalValue: 30, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 30, hasUnit: "kg" },
      primaryAccountable: "commune-dairy", custodianScope: "commune-dairy" }]],
    ["commune-forge", [
      { id: "res-forge-tools", name: "Tool Stock", conformsTo: "tools",
        accountingQuantity: { hasNumericalValue: 20, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 20, hasUnit: "unit" },
        primaryAccountable: "commune-forge", classifiedAs: ["individual-claimable"], custodianScope: "commune-forge" },
      { id: "res-forge-ore", name: "Iron Ore", conformsTo: "ore",
        accountingQuantity: { hasNumericalValue: 400, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 400, hasUnit: "kg" },
        primaryAccountable: "commune-forge", custodianScope: "commune-forge" },
    ]],
    ["commune-workshop", [{ id: "res-workshop-goods", name: "Goods Stock", conformsTo: "goods",
      accountingQuantity: { hasNumericalValue: 16, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 16, hasUnit: "unit" },
      primaryAccountable: "commune-workshop", custodianScope: "commune-workshop" }]],
    ["commune-olive", [{ id: "res-olive-oil", name: "Olive Oil", conformsTo: "olive-oil",
      accountingQuantity: { hasNumericalValue: 36, hasUnit: "liter" }, onhandQuantity: { hasNumericalValue: 36, hasUnit: "liter" },
      primaryAccountable: "commune-olive", custodianScope: "commune-olive" }]],
    ["commune-citrus", [{ id: "res-citrus-fruit", name: "Citrus Fruits", conformsTo: "citrus",
      accountingQuantity: { hasNumericalValue: 60, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 60, hasUnit: "kg" },
      primaryAccountable: "commune-citrus", classifiedAs: ["individual-claimable"], custodianScope: "commune-citrus" }]],
    ["commune-mill", [{ id: "res-mill-flour", name: "Flour Reserve", conformsTo: "flour",
      accountingQuantity: { hasNumericalValue: 24, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 24, hasUnit: "kg" },
      primaryAccountable: "commune-mill", custodianScope: "commune-mill" }]],
    ["commune-bakery", [{ id: "res-bakery-bread", name: "Bread Stock", conformsTo: "bread",
      accountingQuantity: { hasNumericalValue: 50, hasUnit: "loaf" }, onhandQuantity: { hasNumericalValue: 50, hasUnit: "loaf" },
      primaryAccountable: "commune-bakery", classifiedAs: ["individual-claimable"], custodianScope: "commune-bakery" }]],
    ["commune-fisher", [{ id: "res-fisher-fish", name: "Fish Stock", conformsTo: "fish",
      accountingQuantity: { hasNumericalValue: 40, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
      primaryAccountable: "commune-fisher", custodianScope: "commune-fisher" }]],
    ["commune-salter", [{ id: "res-salter-salt", name: "Salt Reserve", conformsTo: "salt",
      accountingQuantity: { hasNumericalValue: 70, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 70, hasUnit: "kg" },
      primaryAccountable: "commune-salter", classifiedAs: ["individual-claimable"], custodianScope: "commune-salter" }]],
    // ── Frontier Tower inventory ──
    ["ft-lounge", [
      { id: "res-ft-meals", name: "Meals Stock", conformsTo: "meals",
        accountingQuantity: { hasNumericalValue: 30, hasUnit: "serving" }, onhandQuantity: { hasNumericalValue: 30, hasUnit: "serving" },
        primaryAccountable: "ft-lounge", custodianScope: "ft-lounge" },
      { id: "res-ft-beans", name: "Coffee Bean Reserve", conformsTo: "coffee-beans",
        accountingQuantity: { hasNumericalValue: 5, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 5, hasUnit: "kg" },
        primaryAccountable: "ft-lounge", custodianScope: "ft-lounge" },
    ]],
    ["ft-coliving", [{ id: "res-ft-coffee", name: "Brewed Coffee", conformsTo: "coffee",
      accountingQuantity: { hasNumericalValue: 20, hasUnit: "cup" }, onhandQuantity: { hasNumericalValue: 20, hasUnit: "cup" },
      primaryAccountable: "ft-coliving", custodianScope: "ft-coliving" }]],
    ["ft-maker", [
      { id: "res-ft-filament", name: "Filament Stock", conformsTo: "3d-filament",
        accountingQuantity: { hasNumericalValue: 10, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 10, hasUnit: "kg" },
        primaryAccountable: "ft-maker", custodianScope: "ft-maker" },
      { id: "res-ft-maker-elec", name: "Electronics Stock", conformsTo: "electronics",
        accountingQuantity: { hasNumericalValue: 8, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 8, hasUnit: "unit" },
        primaryAccountable: "ft-maker", custodianScope: "ft-maker" },
    ]],
    ["ft-robotics", [{ id: "res-ft-prototypes", name: "Prototype Stock", conformsTo: "prototypes",
      accountingQuantity: { hasNumericalValue: 2, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 2, hasUnit: "unit" },
      primaryAccountable: "ft-robotics", custodianScope: "ft-robotics" }]],
    ["ft-arts", [{ id: "res-ft-media", name: "Media Archive", conformsTo: "media-content",
      accountingQuantity: { hasNumericalValue: 4, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 4, hasUnit: "unit" },
      primaryAccountable: "ft-arts", custodianScope: "ft-arts" }]],
    ["ft-neuro", [{ id: "res-ft-reagents", name: "Reagent Supply", conformsTo: "lab-reagents",
      accountingQuantity: { hasNumericalValue: 4, hasUnit: "kit" }, onhandQuantity: { hasNumericalValue: 4, hasUnit: "kit" },
      primaryAccountable: "ft-neuro", custodianScope: "ft-neuro" }]],
    ["ft-ai", [{ id: "res-ft-ai-models", name: "Trained Models", conformsTo: "ai-models",
      accountingQuantity: { hasNumericalValue: 1, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 1, hasUnit: "unit" },
      primaryAccountable: "ft-ai", custodianScope: "ft-ai" }]],
    ["ft-longevity", [{ id: "res-ft-supplements", name: "Supplement Stock", conformsTo: "supplements",
      accountingQuantity: { hasNumericalValue: 8, hasUnit: "dose" }, onhandQuantity: { hasNumericalValue: 8, hasUnit: "dose" },
      primaryAccountable: "ft-longevity", custodianScope: "ft-longevity" }]],
    ["ft-decentral", [{ id: "res-ft-nodes", name: "Node Infrastructure", conformsTo: "node-infra",
      accountingQuantity: { hasNumericalValue: 2, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 2, hasUnit: "unit" },
      primaryAccountable: "ft-decentral", custodianScope: "ft-decentral" }]],
    ["ft-movement", [{ id: "res-ft-fitness", name: "Fitness Sessions", conformsTo: "fitness-sessions",
      accountingQuantity: { hasNumericalValue: 10, hasUnit: "session" }, onhandQuantity: { hasNumericalValue: 10, hasUnit: "session" },
      primaryAccountable: "ft-movement", custodianScope: "ft-movement" }]],
    ["ft-flourishing", [{ id: "res-ft-wellness", name: "Wellness Programs", conformsTo: "wellness-pgm",
      accountingQuantity: { hasNumericalValue: 5, hasUnit: "session" }, onhandQuantity: { hasNumericalValue: 5, hasUnit: "session" },
      primaryAccountable: "ft-flourishing", custodianScope: "ft-flourishing" }]],
    ["ft-coworking", [{ id: "res-ft-compute", name: "GPU Compute Pool", conformsTo: "compute",
      accountingQuantity: { hasNumericalValue: 25, hasUnit: "hr" }, onhandQuantity: { hasNumericalValue: 25, hasUnit: "hr" },
      primaryAccountable: "ft-coworking", custodianScope: "ft-coworking" }]],
    ["ft-events", [{ id: "res-ft-tickets", name: "Event Tickets", conformsTo: "event-tickets",
      accountingQuantity: { hasNumericalValue: 5, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 5, hasUnit: "unit" },
      primaryAccountable: "ft-events", custodianScope: "ft-events" }]],
    ["ft-offices", [{ id: "res-ft-consulting", name: "Consulting Hours", conformsTo: "consulting",
      accountingQuantity: { hasNumericalValue: 10, hasUnit: "hr" }, onhandQuantity: { hasNumericalValue: 10, hasUnit: "hr" },
      primaryAccountable: "ft-offices", custodianScope: "ft-offices" }]],
    ["ft-accelerate", [{ id: "res-ft-ventures", name: "Venture Projects", conformsTo: "ventures",
      accountingQuantity: { hasNumericalValue: 1, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 1, hasUnit: "unit" },
      primaryAccountable: "ft-accelerate", custodianScope: "ft-accelerate" }]],
  ]);
}

export function buildFederationRecipes(): RecipeStore {
  const rs = new RecipeStore();

  // Resource specs — [id, name, defaultUnitOfResource]
  const specDefs: [string, string, string][] = [
    ["wheat",           "Wheat",            "kg"  ],
    ["dairy",           "Dairy",            "kg"  ],
    ["tools",           "Tools",            "unit"],
    ["goods",           "Goods",            "unit"],
    ["olive-oil",       "Olive Oil",        "liter"],
    ["citrus",          "Citrus",           "kg"  ],
    ["flour",           "Flour",            "kg"  ],
    ["bread",           "Bread",            "loaf"],
    ["fish",            "Fish",             "kg"  ],
    ["salt",            "Salt",             "kg"  ],
    ["metal",           "Iron Metal",       "kg"  ],
    ["ore",             "Iron Ore",         "kg"  ],
    ["dough",           "Dough",            "kg"  ],
    ["brine",           "Brine",            "liter"],
    ["raw-flour",       "Raw Flour",        "kg"  ],
    // Extended specs
    ["porridge",        "Wheat Porridge",   "kg"  ],
    ["butter",          "Butter",           "kg"  ],
    ["cheese",          "Cheese",           "kg"  ],
    ["nails",           "Iron Nails",       "unit"],
    ["rope",            "Rope",             "m"   ],
    ["soap",            "Soap",             "unit"],
    ["juice",           "Citrus Juice",     "liter"],
    ["citrus-preserve", "Citrus Preserve",  "jar" ],
    ["pasta",           "Pasta",            "kg"  ],
    ["raw-pasta",       "Raw Pasta",        "kg"  ],
    ["flatbread",       "Flatbread",        "loaf"],
    ["salted-fish",     "Salted Fish",      "kg"  ],
    ["olive-bread",     "Olive Bread",      "loaf"],
    // Capacity-chain specs
    ["malt",            "Malt",             "kg"  ],
    ["ale",             "Ale",              "liter"],
    ["yogurt",          "Yogurt",           "kg"  ],
    ["agri-tools",      "Agricultural Tools","unit"],
    ["smoked-fish",     "Smoked Fish",      "kg"  ],
    ["fish-chowder",    "Fish Chowder",     "kg"  ],
    ["vinegar",         "Citrus Vinegar",   "liter"],
    ["infused-oil",     "Infused Olive Oil","liter"],
    ["citrus-loaf",     "Citrus Loaf",      "loaf"],
    // ── Frontier Tower resource specs ──
    ["compute",          "GPU Compute",           "hr"      ],
    ["electronics",      "Electronic Components", "unit"    ],
    ["3d-filament",      "3D Printing Filament",  "kg"      ],
    ["fabricated-parts", "Fabricated Parts",       "unit"    ],
    ["prototypes",       "Hardware Prototypes",    "unit"    ],
    ["lab-reagents",     "Lab Reagents",           "kit"     ],
    ["bio-samples",      "Bio Samples",            "unit"    ],
    ["supplements",      "Longevity Supplements",  "dose"   ],
    ["media-content",    "Digital Media",          "unit"    ],
    ["meals",            "Prepared Meals",         "serving" ],
    ["fitness-sessions", "Fitness Sessions",       "session" ],
    ["ai-models",        "Trained AI Models",      "unit"    ],
    ["node-infra",       "Node Infrastructure",    "unit"    ],
    ["wellness-pgm",     "Wellness Programs",      "session" ],
    ["coffee-beans",     "Coffee Beans",           "kg"      ],
    ["coffee",           "Brewed Coffee",          "cup"     ],
    ["event-tickets",    "Event Tickets",          "unit"    ],
    ["consulting",       "Consulting Hours",       "hr"      ],
    ["ventures",         "Venture Projects",       "unit"    ],
  ];
  for (const [id, name, defaultUnitOfResource] of specDefs) rs.addResourceSpec({ id, name, defaultUnitOfResource });

  // Process specs
  const procDefs: [string, string][] = [
    ["ps-wheat-harvest", "Wheat Harvest"], ["ps-dairy-prod", "Dairy Production"],
    ["ps-ore-smelting", "Ore Smelting"], ["ps-smithing", "Smithing"],
    ["ps-manufacturing", "Manufacturing"], ["ps-olive-pressing", "Olive Pressing"],
    ["ps-citrus-harvest", "Citrus Harvest"], ["ps-grain-milling", "Grain Milling"],
    ["ps-flour-sifting", "Flour Sifting"], ["ps-dough-proofing", "Dough Proofing"],
    ["ps-baking", "Baking"], ["ps-fishing", "Fishing"],
    ["ps-salt-extraction", "Salt Extraction"],
    // Extended process specs
    ["ps-porridge-cooking", "Porridge Cooking"],
    ["ps-churning", "Butter Churning"],
    ["ps-cheese-making", "Cheese Making"],
    ["ps-nail-forging", "Nail Forging"],
    ["ps-rope-making", "Rope Making"],
    ["ps-soap-making", "Soap Making"],
    ["ps-juice-pressing", "Juice Pressing"],
    ["ps-citrus-curing", "Citrus Curing"],
    ["ps-pasta-rolling", "Pasta Rolling"],
    ["ps-pasta-drying", "Pasta Drying"],
    ["ps-flatbread-baking", "Flatbread Baking"],
    ["ps-fish-salting", "Fish Salting"],
    ["ps-brine-prep", "Brine Preparation"],
    ["ps-olive-bread-baking", "Olive Bread Baking"],
    // Demand-satisfying process specs
    ["ps-wheat-bread",      "Wheat Bread Baking"],
    ["ps-mill-bread",       "Mill Bread Baking"],
    ["ps-communal-bread",   "Communal Bread Baking"],
    ["ps-hardtack",         "Hardtack Baking"],
    ["ps-tool-assembly",    "Tool Assembly"],
    ["ps-stone-grinding",   "Stone Grinding"],
    ["ps-hand-sifting",     "Hand Sifting"],
    ["ps-sea-fishing",      "Sea Fishing"],
    // Capacity-chain process specs
    ["ps-grain-mashing",    "Grain Mashing"],
    ["ps-ale-fermentation", "Ale Fermentation"],
    ["ps-yogurt-making",    "Yogurt Culturing"],
    ["ps-agri-forging",     "Agricultural Forging"],
    ["ps-fish-smoking",     "Fish Smoking"],
    ["ps-chowder-cooking",  "Chowder Cooking"],
    ["ps-citrus-fermentation", "Citrus Fermentation"],
    ["ps-citrus-infusion",  "Citrus Infusion"],
    ["ps-citrus-loaf-mix",  "Citrus Dough Mixing"],
    ["ps-citrus-loaf-bake", "Citrus Loaf Baking"],
    // Self-sufficiency process specs
    ["ps-dairy-bread",      "Dairy Bread Baking"],
    ["ps-forge-bread",      "Forge-Side Baking"],
    ["ps-forge-grinding",   "Forge Stone Grinding"],
    ["ps-workshop-bread",   "Workshop Kitchen Baking"],
    ["ps-workshop-minerals","Workshop Mineral Processing"],
    ["ps-olive-flatbread",  "Olive Flatbread Baking"],
    ["ps-coastal-salt",     "Coastal Salt Harvesting"],
    ["ps-harbor-fishing",   "Harbor Fishing"],
    ["ps-mill-salt",        "Mill Salt Extraction"],
    ["ps-mill-stone-tools", "Mill Stone Tools"],
    ["ps-bakery-dairy",     "Bakery Dairy Production"],
    ["ps-bakery-handmill",  "Bakery Hand Milling"],
    ["ps-fisher-seabread",  "Fisher Sea Bread"],
    ["ps-fisher-implements","Fisher Implement Crafting"],
    ["ps-fisher-grove",     "Fisher Citrus Grove"],
    ["ps-salter-grove",     "Salter Citrus Grove"],
    // ── Frontier Tower process specs ──
    ["ps-ft-meal-prep",      "Tower Meal Preparation"],
    ["ps-ft-coffee-brewing", "Coffee Brewing"],
    ["ps-ft-event-prod",     "Event Production"],
    ["ps-ft-consulting",     "Office Consulting"],
    ["ps-ft-robotics-dev",   "Robotics Development"],
    ["ps-ft-fitness",        "Fitness Training"],
    ["ps-ft-media-creation", "Media Creation"],
    ["ps-ft-fabrication",    "Maker Fabrication"],
    ["ps-ft-neuro-research", "Neuro Research"],
    ["ps-ft-model-training", "AI Model Training"],
    ["ps-ft-incubation",     "Venture Incubation"],
    ["ps-ft-supplement-synth","Supplement Synthesis"],
    ["ps-ft-node-deploy",    "Node Deployment"],
    ["ps-ft-wellness",       "Wellness Programming"],
    ["ps-ft-workspace",      "Workspace Compute Services"],
  ];
  for (const [id, name] of procDefs) rs.addProcessSpec({ id, name });

  // recipe-grain-harvest: work → wheat 300 kg
  {
    const rp = rs.addRecipeProcess({ id: "rp-wheat-harvest", name: "Wheat Harvest", processConformsTo: "ps-wheat-harvest" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 80, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 300, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-grain-harvest", name: "Grain Harvest", primaryOutput: "wheat", recipeProcesses: [rp.id] });
  }
  // recipe-dairy-prod: work → dairy 80 kg
  {
    const rp = rs.addRecipeProcess({ id: "rp-dairy-prod", name: "Dairy Production", processConformsTo: "ps-dairy-prod" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-dairy-prod", name: "Dairy Production", primaryOutput: "dairy", recipeProcesses: [rp.id] });
  }
  // recipe-ore-smithing: ore+work → metal → tools
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-ore-smelting", name: "Ore Smelting", processConformsTo: "ps-ore-smelting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "ore", resourceQuantity: { hasNumericalValue: 120, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp1.id, effortQuantity: { hasNumericalValue: 32, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-smithing", name: "Smithing", processConformsTo: "ps-smithing" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp2.id, effortQuantity: { hasNumericalValue: 48, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "tools", resourceQuantity: { hasNumericalValue: 80, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ore-smithing", name: "Ore Smithing", primaryOutput: "tools", recipeProcesses: [rp1.id, rp2.id] });
  }
  // recipe-manufacturing: work → goods 60 unit
  {
    const rp = rs.addRecipeProcess({ id: "rp-manufacturing", name: "Manufacturing", processConformsTo: "ps-manufacturing" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 60, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "goods", resourceQuantity: { hasNumericalValue: 60, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-manufacturing", name: "Manufacturing", primaryOutput: "goods", recipeProcesses: [rp.id] });
  }
  // recipe-olive-press: work → olive-oil 100 liter
  {
    const rp = rs.addRecipeProcess({ id: "rp-olive-pressing", name: "Olive Pressing", processConformsTo: "ps-olive-pressing" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 50, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 100, hasUnit: "liter" } });
    rs.addRecipe({ id: "recipe-olive-press", name: "Olive Pressing", primaryOutput: "olive-oil", recipeProcesses: [rp.id] });
  }
  // recipe-citrus-harvest: work → citrus 150 kg
  {
    const rp = rs.addRecipeProcess({ id: "rp-citrus-harvest", name: "Citrus Harvest", processConformsTo: "ps-citrus-harvest" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 60, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 150, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-citrus-harvest", name: "Citrus Harvest", primaryOutput: "citrus", recipeProcesses: [rp.id] });
  }
  // recipe-grain-milling: wheat → raw-flour → flour
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-grain-milling", name: "Grain Milling", processConformsTo: "ps-grain-milling" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 200, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp1.id, effortQuantity: { hasNumericalValue: 24, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "raw-flour", resourceQuantity: { hasNumericalValue: 160, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-flour-sifting", name: "Flour Sifting", processConformsTo: "ps-flour-sifting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "raw-flour", resourceQuantity: { hasNumericalValue: 160, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 150, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-grain-milling", name: "Grain Milling", primaryOutput: "flour", recipeProcesses: [rp1.id, rp2.id] });
  }
  // recipe-bread-baking: flour+dairy+salt → dough → bread
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-dough-proofing", name: "Dough Proofing", processConformsTo: "ps-dough-proofing" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "dough", resourceQuantity: { hasNumericalValue: 90, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-baking", name: "Baking", processConformsTo: "ps-baking" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "dough", resourceQuantity: { hasNumericalValue: 90, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp2.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 200, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-bread-baking", name: "Bread Baking", primaryOutput: "bread", recipeProcesses: [rp1.id, rp2.id] });
  }
  // recipe-fishing: work → fish 80 kg
  {
    const rp = rs.addRecipeProcess({ id: "rp-fishing", name: "Fishing", processConformsTo: "ps-fishing" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 60, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-fishing", name: "Fishing", primaryOutput: "fish", recipeProcesses: [rp.id] });
  }
  // recipe-salt-extraction: work → salt 150 kg
  {
    const rp = rs.addRecipeProcess({ id: "rp-salt-extraction", name: "Salt Extraction", processConformsTo: "ps-salt-extraction" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 150, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-salt-extraction", name: "Salt Extraction", primaryOutput: "salt", recipeProcesses: [rp.id] });
  }

  // ── Extended recipes ─────────────────────────────────────────────────────

  // commune-grain: wheat + dairy + salt + work → porridge
  {
    const rp = rs.addRecipeProcess({ id: "rp-porridge-cooking", name: "Porridge Cooking", processConformsTo: "ps-porridge-cooking" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 5, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "porridge", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-wheat-porridge", name: "Wheat Porridge", primaryOutput: "porridge", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-churning", name: "Butter Churning", processConformsTo: "ps-churning" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 5,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "butter", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-butter-churning", name: "Butter Churning", primaryOutput: "butter", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-cheese-making", name: "Cheese Making", processConformsTo: "ps-cheese-making" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 4, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 24, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "cheese", resourceQuantity: { hasNumericalValue: 18, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-cheese-making", name: "Cheese Making", primaryOutput: "cheese", recipeProcesses: [rp.id] });
  }
  {
    const rpSmelt = rs.addRecipeProcess({ id: "rp-nail-smelting", name: "Ore Smelting", processConformsTo: "ps-ore-smelting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rpSmelt.id, resourceConformsTo: "ore", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rpSmelt.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rpSmelt.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    const rpNail = rs.addRecipeProcess({ id: "rp-nail-forging", name: "Nail Forging", processConformsTo: "ps-nail-forging" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rpNail.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rpNail.id, effortQuantity: { hasNumericalValue: 24, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rpNail.id, resourceConformsTo: "nails", resourceQuantity: { hasNumericalValue: 400, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-nail-forging", name: "Iron Nail Forging", primaryOutput: "nails", recipeProcesses: [rpSmelt.id, rpNail.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-rope-making", name: "Rope Making", processConformsTo: "ps-rope-making" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "rope", resourceQuantity: { hasNumericalValue: 50, hasUnit: "m" } });
    rs.addRecipe({ id: "recipe-rope-making", name: "Rope Making", primaryOutput: "rope", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-soap-making", name: "Soap Making", processConformsTo: "ps-soap-making" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 30, hasUnit: "liter" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "soap", resourceQuantity: { hasNumericalValue: 30, hasUnit: "bar" } });
    rs.addRecipe({ id: "recipe-soap-making", name: "Olive Oil Soap", primaryOutput: "soap", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-juice-pressing", name: "Juice Pressing", processConformsTo: "ps-juice-pressing" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 2,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 12, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "juice", resourceQuantity: { hasNumericalValue: 40, hasUnit: "liter" } });
    rs.addRecipe({ id: "recipe-juice-pressing", name: "Citrus Juice", primaryOutput: "juice", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-citrus-curing", name: "Citrus Curing", processConformsTo: "ps-citrus-curing" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 6, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "citrus-preserve", resourceQuantity: { hasNumericalValue: 40, hasUnit: "jar" } });
    rs.addRecipe({ id: "recipe-citrus-curing", name: "Citrus Preserve", primaryOutput: "citrus-preserve", recipeProcesses: [rp.id] });
  }
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-pasta-rolling", name: "Pasta Rolling", processConformsTo: "ps-pasta-rolling" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp1.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "raw-pasta", resourceQuantity: { hasNumericalValue: 55, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-pasta-drying", name: "Pasta Drying", processConformsTo: "ps-pasta-drying" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "raw-pasta", resourceQuantity: { hasNumericalValue: 55, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "pasta", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-pasta-making", name: "Pasta Making", primaryOutput: "pasta", recipeProcesses: [rp1.id, rp2.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-flatbread-baking", name: "Flatbread Baking", processConformsTo: "ps-flatbread-baking" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 3, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "flatbread", resourceQuantity: { hasNumericalValue: 120, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-flatbread", name: "Flatbread", primaryOutput: "flatbread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-olive-bread-baking", name: "Olive Bread Baking", processConformsTo: "ps-olive-bread-baking" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 10, hasUnit: "liter" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 4, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 28, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "olive-bread", resourceQuantity: { hasNumericalValue: 120, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-olive-bread", name: "Olive Bread", primaryOutput: "olive-bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-fish-salting", name: "Fish Salting", processConformsTo: "ps-fish-salting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 14, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "salted-fish", resourceQuantity: { hasNumericalValue: 35, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-salted-fish", name: "Salted Fish", primaryOutput: "salted-fish", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-brine-prep", name: "Brine Preparation", processConformsTo: "ps-brine-prep" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 5,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 8, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "brine", resourceQuantity: { hasNumericalValue: 60, hasUnit: "liter" } });
    rs.addRecipe({ id: "recipe-brine-making", name: "Brine Making", primaryOutput: "brine", recipeProcesses: [rp.id] });
  }

  // ── Demand-satisfying recipes ────────────────────────────────────────────
  {
    const rp = rs.addRecipeProcess({ id: "rp-wheat-bread", name: "Wheat Bread Baking", processConformsTo: "ps-wheat-bread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 4,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 70, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-wheat-bread", name: "Whole Wheat Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-stone-grinding", name: "Stone Grinding", processConformsTo: "ps-stone-grinding" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 100, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work",    recipeInputOf: rp1.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "raw-flour", resourceQuantity: { hasNumericalValue: 75, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-hand-sifting", name: "Hand Sifting", processConformsTo: "ps-hand-sifting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "raw-flour", resourceQuantity: { hasNumericalValue: 75, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 65, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-stone-flour", name: "Stone-Ground Flour", primaryOutput: "flour", recipeProcesses: [rp1.id, rp2.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-mill-bread", name: "Mill Bread Baking", processConformsTo: "ps-mill-bread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 35, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 3,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 90, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-mill-bread", name: "Mill Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-communal-bread", name: "Communal Bread Baking", processConformsTo: "ps-communal-bread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 3,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 75, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-communal-bread", name: "Communal Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-tool-assembly", name: "Tool Assembly", processConformsTo: "ps-tool-assembly" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg"   } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "goods", resourceQuantity: { hasNumericalValue: 5,  hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "tools", resourceQuantity: { hasNumericalValue: 30, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-tool-assembly", name: "Tool Assembly", primaryOutput: "tools", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-hardtack", name: "Hardtack Baking", processConformsTo: "ps-hardtack" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 6,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 100, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-hardtack", name: "Hardtack", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-sea-fishing", name: "Sea Fishing", processConformsTo: "ps-sea-fishing" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 50, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-sea-fishing", name: "Sea Fishing", primaryOutput: "fish", recipeProcesses: [rp.id] });
  }

  // ── Capacity-chain recipes ───────────────────────────────────────────────
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-grain-mashing", name: "Grain Mashing", processConformsTo: "ps-grain-mashing" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 1,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp1.id, effortQuantity: { hasNumericalValue: 12, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "malt", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-ale-fermentation", name: "Ale Fermentation", processConformsTo: "ps-ale-fermentation" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "malt", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp2.id, effortQuantity: { hasNumericalValue: 6, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "ale", resourceQuantity: { hasNumericalValue: 80, hasUnit: "liter" } });
    rs.addRecipe({ id: "recipe-grain-ale", name: "Grain Ale Brewing", primaryOutput: "ale", recipeProcesses: [rp1.id, rp2.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-yogurt-making", name: "Yogurt Culturing", processConformsTo: "ps-yogurt-making" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy",  resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 5,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 8, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "yogurt", resourceQuantity: { hasNumericalValue: 28, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-yogurt", name: "Yogurt", primaryOutput: "yogurt", recipeProcesses: [rp.id] });
  }
  {
    const rpSmelt = rs.addRecipeProcess({ id: "rp-agri-smelting", name: "Ore Smelting", processConformsTo: "ps-ore-smelting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rpSmelt.id, resourceConformsTo: "ore", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rpSmelt.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rpSmelt.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    const rpForge = rs.addRecipeProcess({ id: "rp-agri-forging", name: "Agricultural Forging", processConformsTo: "ps-agri-forging" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rpForge.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rpForge.id, effortQuantity: { hasNumericalValue: 36, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rpForge.id, resourceConformsTo: "agri-tools", resourceQuantity: { hasNumericalValue: 25, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-agri-tools", name: "Agricultural Tools", primaryOutput: "agri-tools", recipeProcesses: [rpSmelt.id, rpForge.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-fish-smoking", name: "Fish Smoking", processConformsTo: "ps-fish-smoking" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 4,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "smoked-fish", resourceQuantity: { hasNumericalValue: 22, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-smoked-fish", name: "Smoked Fish", primaryOutput: "smoked-fish", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-chowder-cooking", name: "Chowder Cooking", processConformsTo: "ps-chowder-cooking" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish",  resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg"  } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg"  } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 4,  hasUnit: "kg"  } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fish-chowder", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-fish-chowder", name: "Fish Chowder", primaryOutput: "fish-chowder", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-citrus-fermentation", name: "Citrus Fermentation", processConformsTo: "ps-citrus-fermentation" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 3,  hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 6, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "vinegar", resourceQuantity: { hasNumericalValue: 25, hasUnit: "liter" } });
    rs.addRecipe({ id: "recipe-citrus-vinegar", name: "Citrus Vinegar", primaryOutput: "vinegar", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-citrus-infusion", name: "Citrus Infusion", processConformsTo: "ps-citrus-infusion" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 20, hasUnit: "liter" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus",    resourceQuantity: { hasNumericalValue: 10, hasUnit: "kg"   } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "infused-oil", resourceQuantity: { hasNumericalValue: 18, hasUnit: "liter" } });
    rs.addRecipe({ id: "recipe-infused-oil", name: "Infused Olive Oil", primaryOutput: "infused-oil", recipeProcesses: [rp.id] });
  }
  {
    const rp1 = rs.addRecipeProcess({ id: "rp-citrus-loaf-mix", name: "Citrus Dough Mixing", processConformsTo: "ps-citrus-loaf-mix" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "flour",  resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "dairy",  resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "dough", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    const rp2 = rs.addRecipeProcess({ id: "rp-citrus-loaf-bake", name: "Citrus Loaf Baking", processConformsTo: "ps-citrus-loaf-bake" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "dough", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp2.id, effortQuantity: { hasNumericalValue: 22, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "citrus-loaf", resourceQuantity: { hasNumericalValue: 80, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-citrus-loaf", name: "Citrus Loaf", primaryOutput: "citrus-loaf", recipeProcesses: [rp1.id, rp2.id] });
  }

  // ── Self-sufficiency recipes ─────────────────────────────────────────────
  {
    const rp = rs.addRecipeProcess({ id: "rp-dairy-bread", name: "Dairy Bread", processConformsTo: "ps-dairy-bread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 14, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 30, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-dairy-bread", name: "Dairy Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-forge-bread", name: "Forge-Side Baking", processConformsTo: "ps-forge-bread" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 12, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 30, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-forge-bread", name: "Forge-Side Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-forge-grinding", name: "Forge Stone Grinding", processConformsTo: "ps-forge-grinding" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "ore", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 35, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-forge-flour", name: "Forge Stone Flour", primaryOutput: "flour", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-workshop-bread", name: "Workshop Kitchen", processConformsTo: "ps-workshop-bread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "goods", resourceQuantity: { hasNumericalValue: 3, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 40, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-workshop-bread", name: "Workshop Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-workshop-minerals", name: "Workshop Mineral Processing", processConformsTo: "ps-workshop-minerals" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "goods", resourceQuantity: { hasNumericalValue: 2, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-workshop-salt", name: "Workshop Salt", primaryOutput: "salt", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-olive-flatbread", name: "Olive Flatbread", processConformsTo: "ps-olive-flatbread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 4, hasUnit: "liter" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 25, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-olive-flatbread", name: "Olive Flatbread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-coastal-salt", name: "Coastal Salt Harvesting", processConformsTo: "ps-coastal-salt" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 22, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-coastal-salt", name: "Coastal Salt", primaryOutput: "salt", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-harbor-fishing", name: "Harbor Fishing", processConformsTo: "ps-harbor-fishing" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-harbor-fishing", name: "Harbor Fishing", primaryOutput: "fish", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-mill-salt", name: "Mill Salt Extraction", processConformsTo: "ps-mill-salt" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-mill-salt", name: "Mill Salt", primaryOutput: "salt", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-mill-tools", name: "Mill Stone Tools", processConformsTo: "ps-mill-stone-tools" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 24, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "tools", resourceQuantity: { hasNumericalValue: 10, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-mill-tools", name: "Mill Tools", primaryOutput: "tools", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-bakery-dairy", name: "Bakery Dairy Production", processConformsTo: "ps-bakery-dairy" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-bakery-dairy", name: "Bakery Dairy", primaryOutput: "dairy", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-bakery-flour", name: "Bakery Hand Milling", processConformsTo: "ps-bakery-handmill" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 36, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 90, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-bakery-flour", name: "Bakery Hand-Milled Flour", primaryOutput: "flour", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-fisher-bread", name: "Fisher Sea Bread", processConformsTo: "ps-fisher-seabread" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 12, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 30, hasUnit: "loaf" } });
    rs.addRecipe({ id: "recipe-fisher-bread", name: "Fisher Sea Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-fisher-tools", name: "Fisher Implement Crafting", processConformsTo: "ps-fisher-implements" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 5, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "tools", resourceQuantity: { hasNumericalValue: 12, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-fisher-tools", name: "Fisher Tools", primaryOutput: "tools", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-fisher-citrus", name: "Fisher Citrus Grove", processConformsTo: "ps-fisher-grove" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 15, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-fisher-citrus", name: "Fisher Citrus", primaryOutput: "citrus", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-salter-citrus", name: "Salter Citrus Grove", processConformsTo: "ps-salter-grove" });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 15, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg" } });
    rs.addRecipe({ id: "recipe-salter-citrus", name: "Salter Citrus", primaryOutput: "citrus", recipeProcesses: [rp.id] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Frontier Tower recipes
  // ══════════════════════════════════════════════════════════════════════════
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-meal-prep", name: "Tower Meal Prep", processConformsTo: "ps-ft-meal-prep" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "coffee-beans", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "meals", resourceQuantity: { hasNumericalValue: 200, hasUnit: "serving" } });
    rs.addRecipe({ id: "recipe-ft-meals", name: "Tower Meal Preparation", primaryOutput: "meals", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-coffee-brewing", name: "Coffee Brewing", processConformsTo: "ps-ft-coffee-brewing" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "coffee-beans", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "coffee", resourceQuantity: { hasNumericalValue: 150, hasUnit: "cup" } });
    rs.addRecipe({ id: "recipe-ft-coffee", name: "Coffee Brewing", primaryOutput: "coffee", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-event-prod", name: "Event Production", processConformsTo: "ps-ft-event-prod" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "media-content", resourceQuantity: { hasNumericalValue: 8, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "meals", resourceQuantity: { hasNumericalValue: 40, hasUnit: "serving" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "event-tickets", resourceQuantity: { hasNumericalValue: 25, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-events", name: "Event Production", primaryOutput: "event-tickets", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-consulting", name: "Office Consulting", processConformsTo: "ps-ft-consulting" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "coffee", resourceQuantity: { hasNumericalValue: 30, hasUnit: "cup" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "consulting", resourceQuantity: { hasNumericalValue: 60, hasUnit: "hr" } });
    rs.addRecipe({ id: "recipe-ft-consulting", name: "Office Consulting", primaryOutput: "consulting", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-robotics-dev", name: "Robotics Dev", processConformsTo: "ps-ft-robotics-dev" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fabricated-parts", resourceQuantity: { hasNumericalValue: 10, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "electronics", resourceQuantity: { hasNumericalValue: 25, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 60, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "prototypes", resourceQuantity: { hasNumericalValue: 8, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-prototypes", name: "Robotics Prototyping", primaryOutput: "prototypes", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-fitness", name: "Fitness Training", processConformsTo: "ps-ft-fitness" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "meals", resourceQuantity: { hasNumericalValue: 15, hasUnit: "serving" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fitness-sessions", resourceQuantity: { hasNumericalValue: 50, hasUnit: "session" } });
    rs.addRecipe({ id: "recipe-ft-fitness", name: "Fitness Training", primaryOutput: "fitness-sessions", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-media-creation", name: "Media Creation", processConformsTo: "ps-ft-media-creation" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "3d-filament", resourceQuantity: { hasNumericalValue: 5, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 8, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 35, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "media-content", resourceQuantity: { hasNumericalValue: 20, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-media", name: "Media Creation", primaryOutput: "media-content", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-fabrication", name: "Maker Fabrication", processConformsTo: "ps-ft-fabrication" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "3d-filament", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "electronics", resourceQuantity: { hasNumericalValue: 20, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 50, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fabricated-parts", resourceQuantity: { hasNumericalValue: 25, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-fabrication", name: "Maker Fabrication", primaryOutput: "fabricated-parts", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-neuro-research", name: "Neuro Research", processConformsTo: "ps-ft-neuro-research" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "lab-reagents", resourceQuantity: { hasNumericalValue: 10, hasUnit: "kit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 25, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bio-samples", resourceQuantity: { hasNumericalValue: 12, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-bio-samples", name: "Neuro Bio-Sampling", primaryOutput: "bio-samples", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-model-training", name: "AI Model Training", processConformsTo: "ps-ft-model-training" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 80, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "electronics", resourceQuantity: { hasNumericalValue: 5, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "ai-models", resourceQuantity: { hasNumericalValue: 5, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-ai-models", name: "AI Model Training", primaryOutput: "ai-models", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-incubation", name: "Venture Incubation", processConformsTo: "ps-ft-incubation" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "prototypes", resourceQuantity: { hasNumericalValue: 3, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "media-content", resourceQuantity: { hasNumericalValue: 5, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "consulting", resourceQuantity: { hasNumericalValue: 15, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 50, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "ventures", resourceQuantity: { hasNumericalValue: 4, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-ventures", name: "Venture Incubation", primaryOutput: "ventures", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-supplement-synth", name: "Supplement Synthesis", processConformsTo: "ps-ft-supplement-synth" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "bio-samples", resourceQuantity: { hasNumericalValue: 6, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "lab-reagents", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "supplements", resourceQuantity: { hasNumericalValue: 30, hasUnit: "dose" } });
    rs.addRecipe({ id: "recipe-ft-supplements", name: "Supplement Synthesis", primaryOutput: "supplements", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-node-deploy", name: "Node Deployment", processConformsTo: "ps-ft-node-deploy" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 40, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "electronics", resourceQuantity: { hasNumericalValue: 12, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 25, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "node-infra", resourceQuantity: { hasNumericalValue: 8, hasUnit: "unit" } });
    rs.addRecipe({ id: "recipe-ft-node-infra", name: "Node Deployment", primaryOutput: "node-infra", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-wellness", name: "Wellness Programming", processConformsTo: "ps-ft-wellness" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fitness-sessions", resourceQuantity: { hasNumericalValue: 15, hasUnit: "session" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "supplements", resourceQuantity: { hasNumericalValue: 10, hasUnit: "dose" } });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "meals", resourceQuantity: { hasNumericalValue: 20, hasUnit: "serving" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "wellness-pgm", resourceQuantity: { hasNumericalValue: 20, hasUnit: "session" } });
    rs.addRecipe({ id: "recipe-ft-wellness", name: "Wellness Programs", primaryOutput: "wellness-pgm", recipeProcesses: [rp.id] });
  }
  {
    const rp = rs.addRecipeProcess({ id: "rp-ft-workspace", name: "Workspace Compute", processConformsTo: "ps-ft-workspace" });
    rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "electronics", resourceQuantity: { hasNumericalValue: 8, hasUnit: "unit" } });
    rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 15, hasUnit: "hr" } });
    rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "compute", resourceQuantity: { hasNumericalValue: 100, hasUnit: "hr" } });
    rs.addRecipe({ id: "recipe-ft-compute", name: "Workspace Compute Services", primaryOutput: "compute", recipeProcesses: [rp.id] });
  }

  return rs;
}
