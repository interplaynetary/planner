<script lang="ts">
  import "$lib/components/ui/tokens.css";
  import FederationGraphView from "$lib/components/federation/FederationGraphView.svelte";
  import FederationEventLog from "$lib/components/federation/FederationEventLog.svelte";
  import InventoryBand from "$lib/components/federation/InventoryBand.svelte";
  import ScopeNetworkDiagram from "$lib/components/federation/ScopeNetworkDiagram.svelte";
  import ScopeRecipesPanel from "$lib/components/federation/ScopeRecipesPanel.svelte";
  import EventRecorderPanel from "$lib/components/observation/EventRecorderPanel.svelte";
  import type { FlowSelectCtx } from "$lib/components/vf/observe-types";
  import type { TradeProposal, FederationEvent } from "$lib/planning/plan-federation";
  import { Observer } from "$lib/observation/observer";
  import type { EconomicResource, Intent, ResourceSpecification } from "$lib/schemas";
  import ResourceDemandCard from "$lib/components/commune/ResourceDemandCard.svelte";
  import { buildIndependentDemandIndex } from "$lib/indexes/independent-demand";
  import { buildIndependentSupplyIndex, querySupplyByScope } from "$lib/indexes/independent-supply";
  import { buildAgentIndex } from "$lib/indexes/agents";
  import { planFederation } from "$lib/planning/plan-federation";
  import { RecipeStore } from "$lib/knowledge/recipes";

  // ---------------------------------------------------------------------------
  // specNames
  // ---------------------------------------------------------------------------

  const specNames: Record<string, string> = {
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
  };

  // ---------------------------------------------------------------------------
  // RecipeStore — commune production templates
  // ---------------------------------------------------------------------------

  function buildFederationRecipes(): RecipeStore {
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
      // Demand-satisfying process specs (bread/tools/flour at multiple scopes)
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

    // commune-dairy: dairy + work → butter
    {
      const rp = rs.addRecipeProcess({ id: "rp-churning", name: "Butter Churning", processConformsTo: "ps-churning" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "butter", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-butter-churning", name: "Butter Churning", primaryOutput: "butter", recipeProcesses: [rp.id] });
    }

    // commune-dairy: dairy + salt + work → cheese
    {
      const rp = rs.addRecipeProcess({ id: "rp-cheese-making", name: "Cheese Making", processConformsTo: "ps-cheese-making" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 4, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 24, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "cheese", resourceQuantity: { hasNumericalValue: 18, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-cheese-making", name: "Cheese Making", primaryOutput: "cheese", recipeProcesses: [rp.id] });
    }

    // commune-forge: ore → metal → nails
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

    // commune-workshop: work → rope
    {
      const rp = rs.addRecipeProcess({ id: "rp-rope-making", name: "Rope Making", processConformsTo: "ps-rope-making" });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "rope", resourceQuantity: { hasNumericalValue: 50, hasUnit: "m" } });
      rs.addRecipe({ id: "recipe-rope-making", name: "Rope Making", primaryOutput: "rope", recipeProcesses: [rp.id] });
    }

    // commune-olive: olive-oil + salt + work → soap
    {
      const rp = rs.addRecipeProcess({ id: "rp-soap-making", name: "Soap Making", processConformsTo: "ps-soap-making" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 30, hasUnit: "liter" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "soap", resourceQuantity: { hasNumericalValue: 30, hasUnit: "bar" } });
      rs.addRecipe({ id: "recipe-soap-making", name: "Olive Oil Soap", primaryOutput: "soap", recipeProcesses: [rp.id] });
    }

    // commune-citrus: citrus + work → juice
    {
      const rp = rs.addRecipeProcess({ id: "rp-juice-pressing", name: "Juice Pressing", processConformsTo: "ps-juice-pressing" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 12, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "juice", resourceQuantity: { hasNumericalValue: 40, hasUnit: "liter" } });
      rs.addRecipe({ id: "recipe-juice-pressing", name: "Citrus Juice", primaryOutput: "juice", recipeProcesses: [rp.id] });
    }

    // commune-citrus: citrus + salt + work → citrus-preserve
    {
      const rp = rs.addRecipeProcess({ id: "rp-citrus-curing", name: "Citrus Curing", processConformsTo: "ps-citrus-curing" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 6, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "citrus-preserve", resourceQuantity: { hasNumericalValue: 40, hasUnit: "jar" } });
      rs.addRecipe({ id: "recipe-citrus-curing", name: "Citrus Preserve", primaryOutput: "citrus-preserve", recipeProcesses: [rp.id] });
    }

    // commune-mill: flour + work → raw-pasta → pasta
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

    // commune-mill: flour + salt + work → flatbread
    {
      const rp = rs.addRecipeProcess({ id: "rp-flatbread-baking", name: "Flatbread Baking", processConformsTo: "ps-flatbread-baking" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 3, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "flatbread", resourceQuantity: { hasNumericalValue: 120, hasUnit: "loaf" } });
      rs.addRecipe({ id: "recipe-flatbread", name: "Flatbread", primaryOutput: "flatbread", recipeProcesses: [rp.id] });
    }

    // commune-bakery: flour + olive-oil + salt + work → olive-bread
    {
      const rp = rs.addRecipeProcess({ id: "rp-olive-bread-baking", name: "Olive Bread Baking", processConformsTo: "ps-olive-bread-baking" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 10, hasUnit: "liter" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 4, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 28, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "olive-bread", resourceQuantity: { hasNumericalValue: 120, hasUnit: "loaf" } });
      rs.addRecipe({ id: "recipe-olive-bread", name: "Olive Bread", primaryOutput: "olive-bread", recipeProcesses: [rp.id] });
    }

    // commune-fisher: fish + salt + work → salted-fish
    {
      const rp = rs.addRecipeProcess({ id: "rp-fish-salting", name: "Fish Salting", processConformsTo: "ps-fish-salting" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 8, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 14, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "salted-fish", resourceQuantity: { hasNumericalValue: 35, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-salted-fish", name: "Salted Fish", primaryOutput: "salted-fish", recipeProcesses: [rp.id] });
    }

    // commune-salter: salt + work → brine
    {
      const rp = rs.addRecipeProcess({ id: "rp-brine-prep", name: "Brine Preparation", processConformsTo: "ps-brine-prep" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 8, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "brine", resourceQuantity: { hasNumericalValue: 60, hasUnit: "liter" } });
      rs.addRecipe({ id: "recipe-brine-making", name: "Brine Making", primaryOutput: "brine", recipeProcesses: [rp.id] });
    }

    // ── Demand-satisfying recipes: bread/tools/flour across multiple scopes ──

    // commune-grain → Whole Wheat Bread: uses grain's own wheat + salt from salter
    {
      const rp = rs.addRecipeProcess({ id: "rp-wheat-bread", name: "Wheat Bread Baking", processConformsTo: "ps-wheat-bread" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 4,  hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 70, hasUnit: "loaf" } });
      rs.addRecipe({ id: "recipe-wheat-bread", name: "Whole Wheat Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
    }

    // commune-grain → Stone-Ground Flour: wheat + work → raw-flour → flour (local backup milling)
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

    // commune-mill → Mill Bread: mill uses its own flour surplus to bake bread
    {
      const rp = rs.addRecipeProcess({ id: "rp-mill-bread", name: "Mill Bread Baking", processConformsTo: "ps-mill-bread" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 35, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 3,  hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 18, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 90, hasUnit: "loaf" } });
      rs.addRecipe({ id: "recipe-mill-bread", name: "Mill Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
    }

    // commune-workshop → Communal Bread: workshop communal kitchen (flour from mill + salt)
    {
      const rp = rs.addRecipeProcess({ id: "rp-communal-bread", name: "Communal Bread Baking", processConformsTo: "ps-communal-bread" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 3,  hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 75, hasUnit: "loaf" } });
      rs.addRecipe({ id: "recipe-communal-bread", name: "Communal Bread", primaryOutput: "bread", recipeProcesses: [rp.id] });
    }

    // commune-workshop → Tool Assembly: metal from forge + goods + work → tools
    {
      const rp = rs.addRecipeProcess({ id: "rp-tool-assembly", name: "Tool Assembly", processConformsTo: "ps-tool-assembly" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "metal", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg"   } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "goods", resourceQuantity: { hasNumericalValue: 5,  hasUnit: "unit" } });
      rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 30, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "tools", resourceQuantity: { hasNumericalValue: 30, hasUnit: "unit" } });
      rs.addRecipe({ id: "recipe-tool-assembly", name: "Tool Assembly", primaryOutput: "tools", recipeProcesses: [rp.id] });
    }

    // commune-salter → Hardtack: maritime staple bread from flour + salt (no yeast needed)
    {
      const rp = rs.addRecipeProcess({ id: "rp-hardtack", name: "Hardtack Baking", processConformsTo: "ps-hardtack" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 6,  hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work",    recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "bread", resourceQuantity: { hasNumericalValue: 100, hasUnit: "loaf" } });
      rs.addRecipe({ id: "recipe-hardtack", name: "Hardtack", primaryOutput: "bread", recipeProcesses: [rp.id] });
    }

    // commune-salter → Sea Fishing: maritime commune supplements fisher's output
    {
      const rp = rs.addRecipeProcess({ id: "rp-sea-fishing", name: "Sea Fishing", processConformsTo: "ps-sea-fishing" });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 50, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-sea-fishing", name: "Sea Fishing", primaryOutput: "fish", recipeProcesses: [rp.id] });
    }

    // ── Capacity-chain recipes (cross-commune dependencies) ─────────────────

    // commune-grain: wheat → malt → ale  (uses grain's 320 kg wheat capacity)
    {
      const rp1 = rs.addRecipeProcess({ id: "rp-grain-mashing", name: "Grain Mashing", processConformsTo: "ps-grain-mashing" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp1.id, resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 80, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp1.id, effortQuantity: { hasNumericalValue: 12, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp1.id, resourceConformsTo: "malt", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
      const rp2 = rs.addRecipeProcess({ id: "rp-ale-fermentation", name: "Ale Fermentation", processConformsTo: "ps-ale-fermentation" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp2.id, resourceConformsTo: "malt", resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp2.id, effortQuantity: { hasNumericalValue: 6, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp2.id, resourceConformsTo: "ale", resourceQuantity: { hasNumericalValue: 80, hasUnit: "liter" } });
      rs.addRecipe({ id: "recipe-grain-ale", name: "Grain Ale Brewing", primaryOutput: "ale", recipeProcesses: [rp1.id, rp2.id] });
    }

    // commune-dairy: dairy + work → yogurt  (uses dairy's 80 kg capacity)
    {
      const rp = rs.addRecipeProcess({ id: "rp-yogurt-making", name: "Yogurt Culturing", processConformsTo: "ps-yogurt-making" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 8, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "yogurt", resourceQuantity: { hasNumericalValue: 28, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-yogurt", name: "Yogurt", primaryOutput: "yogurt", recipeProcesses: [rp.id] });
    }

    // commune-forge: ore → metal → agri-tools  (distinct from general tools; consumed by grain commune)
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

    // commune-fisher: fish + work → smoked-fish  (uses fisher's 80 kg capacity)
    {
      const rp = rs.addRecipeProcess({ id: "rp-fish-smoking", name: "Fish Smoking", processConformsTo: "ps-fish-smoking" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish", resourceQuantity: { hasNumericalValue: 30, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 20, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "smoked-fish", resourceQuantity: { hasNumericalValue: 22, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-smoked-fish", name: "Smoked Fish", primaryOutput: "smoked-fish", recipeProcesses: [rp.id] });
    }

    // commune-fisher: fish + dairy + salt + work → fish-chowder  (draws on dairy + salt from federation)
    {
      const rp = rs.addRecipeProcess({ id: "rp-chowder-cooking", name: "Chowder Cooking", processConformsTo: "ps-chowder-cooking" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "fish",  resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg"  } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg"  } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "salt",  resourceQuantity: { hasNumericalValue: 4,  hasUnit: "kg"  } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 16, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "fish-chowder", resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" } });
      rs.addRecipe({ id: "recipe-fish-chowder", name: "Fish Chowder", primaryOutput: "fish-chowder", recipeProcesses: [rp.id] });
    }

    // commune-citrus: citrus + work → vinegar  (fermentation; useful as preservative across federation)
    {
      const rp = rs.addRecipeProcess({ id: "rp-citrus-fermentation", name: "Citrus Fermentation", processConformsTo: "ps-citrus-fermentation" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 6, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "vinegar", resourceQuantity: { hasNumericalValue: 25, hasUnit: "liter" } });
      rs.addRecipe({ id: "recipe-citrus-vinegar", name: "Citrus Vinegar", primaryOutput: "vinegar", recipeProcesses: [rp.id] });
    }

    // commune-olive: olive-oil + citrus + work → infused-oil  (draws citrus from citrus commune)
    {
      const rp = rs.addRecipeProcess({ id: "rp-citrus-infusion", name: "Citrus Infusion", processConformsTo: "ps-citrus-infusion" });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 20, hasUnit: "liter" } });
      rs.addRecipeFlow({ action: "consume", recipeInputOf: rp.id, resourceConformsTo: "citrus",    resourceQuantity: { hasNumericalValue: 10, hasUnit: "kg"   } });
      rs.addRecipeFlow({ action: "work", recipeInputOf: rp.id, effortQuantity: { hasNumericalValue: 10, hasUnit: "hr" } });
      rs.addRecipeFlow({ action: "produce", recipeOutputOf: rp.id, resourceConformsTo: "infused-oil", resourceQuantity: { hasNumericalValue: 18, hasUnit: "liter" } });
      rs.addRecipe({ id: "recipe-infused-oil", name: "Infused Olive Oil", primaryOutput: "infused-oil", recipeProcesses: [rp.id] });
    }

    // commune-bakery: flour + citrus + dairy → citrus-dough → citrus-loaf
    // (draws flour from mill, citrus from citrus commune, dairy from dairy commune)
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

    return rs;
  }

  const recipeStore = buildFederationRecipes();

  // ---------------------------------------------------------------------------
  // Per-scope observed resources (inventory — all have custodianScope set)
  // ---------------------------------------------------------------------------

  // Safety-stock levels only — kept low so demand exceeds on-hand and recipes fire
  const mockResources = new Map<string, EconomicResource[]>([
    ["commune-grain", [{ id: "res-grain-wheat", name: "Wheat Reserve", conformsTo: "wheat",
      accountingQuantity: { hasNumericalValue: 40, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
      primaryAccountable: "commune-grain", custodianScope: "commune-grain" }]],
    ["commune-dairy", [{ id: "res-dairy-dairy", name: "Dairy Stock", conformsTo: "dairy",
      accountingQuantity: { hasNumericalValue: 15, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 15, hasUnit: "kg" },
      primaryAccountable: "commune-dairy", custodianScope: "commune-dairy" }]],
    ["commune-forge", [
      { id: "res-forge-tools", name: "Tool Stock", conformsTo: "tools",
        accountingQuantity: { hasNumericalValue: 10, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 10, hasUnit: "unit" },
        primaryAccountable: "commune-forge", classifiedAs: ["individual-claimable"], custodianScope: "commune-forge" },
      { id: "res-forge-ore", name: "Iron Ore", conformsTo: "ore",
        accountingQuantity: { hasNumericalValue: 200, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 200, hasUnit: "kg" },
        primaryAccountable: "commune-forge", custodianScope: "commune-forge" },
    ]],
    ["commune-workshop", [{ id: "res-workshop-goods", name: "Goods Stock", conformsTo: "goods",
      accountingQuantity: { hasNumericalValue: 8, hasUnit: "unit" }, onhandQuantity: { hasNumericalValue: 8, hasUnit: "unit" },
      primaryAccountable: "commune-workshop", custodianScope: "commune-workshop" }]],
    ["commune-olive", [{ id: "res-olive-oil", name: "Olive Oil", conformsTo: "olive-oil",
      accountingQuantity: { hasNumericalValue: 18, hasUnit: "liter" }, onhandQuantity: { hasNumericalValue: 18, hasUnit: "liter" },
      primaryAccountable: "commune-olive", custodianScope: "commune-olive" }]],
    ["commune-citrus", [{ id: "res-citrus-fruit", name: "Citrus Fruits", conformsTo: "citrus",
      accountingQuantity: { hasNumericalValue: 30, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 30, hasUnit: "kg" },
      primaryAccountable: "commune-citrus", classifiedAs: ["individual-claimable"], custodianScope: "commune-citrus" }]],
    ["commune-mill", [{ id: "res-mill-flour", name: "Flour Reserve", conformsTo: "flour",
      accountingQuantity: { hasNumericalValue: 12, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 12, hasUnit: "kg" },
      primaryAccountable: "commune-mill", custodianScope: "commune-mill" }]],
    ["commune-bakery", [{ id: "res-bakery-bread", name: "Bread Stock", conformsTo: "bread",
      accountingQuantity: { hasNumericalValue: 25, hasUnit: "loaf" }, onhandQuantity: { hasNumericalValue: 25, hasUnit: "loaf" },
      primaryAccountable: "commune-bakery", classifiedAs: ["individual-claimable"], custodianScope: "commune-bakery" }]],
    ["commune-fisher", [{ id: "res-fisher-fish", name: "Fish Stock", conformsTo: "fish",
      accountingQuantity: { hasNumericalValue: 20, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 20, hasUnit: "kg" },
      primaryAccountable: "commune-fisher", custodianScope: "commune-fisher" }]],
    ["commune-salter", [{ id: "res-salter-salt", name: "Salt Reserve", conformsTo: "salt",
      accountingQuantity: { hasNumericalValue: 35, hasUnit: "kg" }, onhandQuantity: { hasNumericalValue: 35, hasUnit: "kg" },
      primaryAccountable: "commune-salter", classifiedAs: ["individual-claimable"], custodianScope: "commune-salter" }]],
  ]);

  // ---- Buffer zones per scope (spec-based, unchanged) -----------------------
  const mockBufferZones = new Map([
    ["commune-forge", [{ specId: "tools", tor: 25, toy: 50, tog: 80 }]],
    ["commune-mill", [{ specId: "flour", tor: 30, toy: 70, tog: 150 }]],
    ["commune-bakery", [{ specId: "bread", tor: 50, toy: 100, tog: 200 }]],
    ["commune-grain", [{ specId: "wheat", tor: 80, toy: 160, tog: 300 }]],
    ["commune-salter", [{ specId: "salt", tor: 40, toy: 90, tog: 200 }]],
    ["commune-fisher", [{ specId: "fish", tor: 20, toy: 50, tog: 120 }]],
  ]);

  const parentMap: Record<string, string> = {
    "agri-federation": "universal-commune",
    "manufacturing-federation": "universal-commune",
    "horticulture-federation": "universal-commune",
    "food-processing-federation": "universal-commune",
    "maritime-federation": "universal-commune",
    "commune-grain": "agri-federation",
    "commune-dairy": "agri-federation",
    "commune-forge": "manufacturing-federation",
    "commune-workshop": "manufacturing-federation",
    "commune-olive": "horticulture-federation",
    "commune-citrus": "horticulture-federation",
    "commune-mill": "food-processing-federation",
    "commune-bakery": "food-processing-federation",
    "commune-fisher": "maritime-federation",
    "commune-salter": "maritime-federation",
  };

  function mockParentOf(id: string): string | undefined {
    return parentMap[id];
  }

  // ---------------------------------------------------------------------------
  // Demand intents — infra cross-scope needs + claimable demands
  // ---------------------------------------------------------------------------

  let demandIntents = $state<Intent[]>([
    // Infra: 5 cross-federation exchanges
    { id: "di-mill-wheat",   action: "transfer", resourceConformsTo: "wheat", resourceQuantity: { hasNumericalValue: 200, hasUnit: "kg"   }, inScopeOf: ["commune-mill"],    due: "2026-04-01" },
    { id: "di-grain-tools",  action: "transfer", resourceConformsTo: "tools", resourceQuantity: { hasNumericalValue: 15,  hasUnit: "unit" }, inScopeOf: ["commune-grain"],   due: "2026-04-01" },
    { id: "di-bakery-dairy", action: "transfer", resourceConformsTo: "dairy", resourceQuantity: { hasNumericalValue: 30,  hasUnit: "kg"   }, inScopeOf: ["commune-bakery"],  due: "2026-04-01" },
    { id: "di-forge-flour",  action: "transfer", resourceConformsTo: "flour", resourceQuantity: { hasNumericalValue: 30,  hasUnit: "kg"   }, inScopeOf: ["commune-forge"],   due: "2026-04-01" },
    { id: "di-citrus-fish",  action: "transfer", resourceConformsTo: "fish",  resourceQuantity: { hasNumericalValue: 40,  hasUnit: "kg"   }, inScopeOf: ["commune-citrus"],  due: "2026-04-01" },
    // Claimable: bread
    { id: "ci-grain-bread",    action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 30, hasUnit: "loaf" }, inScopeOf: ["commune-grain"],    due: "2026-04-01" },
    { id: "ci-dairy-bread",    action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 20, hasUnit: "loaf" }, inScopeOf: ["commune-dairy"],    due: "2026-04-01" },
    { id: "ci-forge-bread",    action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 20, hasUnit: "loaf" }, inScopeOf: ["commune-forge"],    due: "2026-04-01" },
    { id: "ci-workshop-bread", action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 25, hasUnit: "loaf" }, inScopeOf: ["commune-workshop"], due: "2026-04-01" },
    { id: "ci-olive-bread",    action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 20, hasUnit: "loaf" }, inScopeOf: ["commune-olive"],    due: "2026-04-01" },
    { id: "ci-fisher-bread",   action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 25, hasUnit: "loaf" }, inScopeOf: ["commune-fisher"],   due: "2026-04-01" },
    { id: "ci-salter-bread",   action: "transfer", resourceConformsTo: "bread",  resourceQuantity: { hasNumericalValue: 20, hasUnit: "loaf" }, inScopeOf: ["commune-salter"],   due: "2026-04-01" },
    // Claimable: salt
    { id: "ci-grain-salt",     action: "transfer", resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg"   }, inScopeOf: ["commune-grain"],    due: "2026-04-01" },
    { id: "ci-workshop-salt",  action: "transfer", resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 18, hasUnit: "kg"   }, inScopeOf: ["commune-workshop"], due: "2026-04-01" },
    { id: "ci-olive-salt",     action: "transfer", resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 12, hasUnit: "kg"   }, inScopeOf: ["commune-olive"],    due: "2026-04-01" },
    { id: "ci-citrus-salt",    action: "transfer", resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg"   }, inScopeOf: ["commune-citrus"],   due: "2026-04-01" },
    { id: "ci-mill-salt",      action: "transfer", resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 10, hasUnit: "kg"   }, inScopeOf: ["commune-mill"],     due: "2026-04-01" },
    { id: "ci-bakery-salt",    action: "transfer", resourceConformsTo: "salt",   resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg"   }, inScopeOf: ["commune-bakery"],   due: "2026-04-01" },
    // Claimable: tools
    { id: "ci-dairy-tools",    action: "transfer", resourceConformsTo: "tools",  resourceQuantity: { hasNumericalValue:  8, hasUnit: "unit" }, inScopeOf: ["commune-dairy"],    due: "2026-04-01" },
    { id: "ci-mill-tools",     action: "transfer", resourceConformsTo: "tools",  resourceQuantity: { hasNumericalValue: 10, hasUnit: "unit" }, inScopeOf: ["commune-mill"],     due: "2026-04-01" },
    { id: "ci-fisher-tools",   action: "transfer", resourceConformsTo: "tools",  resourceQuantity: { hasNumericalValue: 12, hasUnit: "unit" }, inScopeOf: ["commune-fisher"],   due: "2026-04-01" },
    { id: "ci-bakery-tools",   action: "transfer", resourceConformsTo: "tools",  resourceQuantity: { hasNumericalValue:  8, hasUnit: "unit" }, inScopeOf: ["commune-bakery"],   due: "2026-04-01" },
    { id: "ci-citrus-tools",   action: "transfer", resourceConformsTo: "tools",  resourceQuantity: { hasNumericalValue:  6, hasUnit: "unit" }, inScopeOf: ["commune-citrus"],   due: "2026-04-01" },
    // Claimable: citrus
    { id: "ci-forge-citrus",   action: "transfer", resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg"   }, inScopeOf: ["commune-forge"],    due: "2026-04-01" },
    { id: "ci-workshop-citrus",action: "transfer", resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 25, hasUnit: "kg"   }, inScopeOf: ["commune-workshop"], due: "2026-04-01" },
    { id: "ci-mill-citrus",    action: "transfer", resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 20, hasUnit: "kg"   }, inScopeOf: ["commune-mill"],     due: "2026-04-01" },
    { id: "ci-fisher-citrus",  action: "transfer", resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 15, hasUnit: "kg"   }, inScopeOf: ["commune-fisher"],   due: "2026-04-01" },
    { id: "ci-salter-citrus",  action: "transfer", resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 18, hasUnit: "kg"   }, inScopeOf: ["commune-salter"],   due: "2026-04-01" },
    { id: "ci-bakery-citrus",  action: "transfer", resourceConformsTo: "citrus", resourceQuantity: { hasNumericalValue: 22, hasUnit: "kg"   }, inScopeOf: ["commune-bakery"],   due: "2026-04-01" },
    // Cross-scope: connect mill → bakery flour flow
    { id: "di-bakery-flour",   action: "transfer", resourceConformsTo: "flour",  resourceQuantity: { hasNumericalValue: 80,  hasUnit: "kg"   }, inScopeOf: ["commune-bakery"],   due: "2026-04-01" },
  ]);

  // ---------------------------------------------------------------------------
  // Combined Observer + indexes
  // ---------------------------------------------------------------------------

  const combinedObserver = new Observer();
  const allInventory = [...mockResources.values()].flat();
  for (const r of allInventory) combinedObserver.seedResource(r);

  const parentOfMap = new Map(Object.entries(parentMap));
  const emptyAgentIndex = buildAgentIndex([], [], new Map());

  // Produce intents: each commune's committed production run.
  // Phase B of planForScope sees these as supply slots → generates SurplusSignal → lateral matching has a non-empty surplusPool.
  const produceIntents: Intent[] = [
    // Primary harvesters / extractors — no inputs needed
    // outputOf references the actual recipe process ID that produces this spec
    { id: "pi-grain-wheat",    action: "produce", outputOf: "rp-wheat-harvest",   resourceConformsTo: "wheat",     resourceQuantity: { hasNumericalValue: 320,  hasUnit: "kg"    }, inScopeOf: ["commune-grain"]    },
    { id: "pi-dairy-dairy",    action: "produce", outputOf: "rp-dairy-prod",       resourceConformsTo: "dairy",     resourceQuantity: { hasNumericalValue: 80,   hasUnit: "kg"    }, inScopeOf: ["commune-dairy"]    },
    { id: "pi-forge-tools",    action: "produce", outputOf: "rp-smithing",         resourceConformsTo: "tools",     resourceQuantity: { hasNumericalValue: 80,   hasUnit: "unit"  }, inScopeOf: ["commune-forge"]    },
    { id: "pi-workshop-goods", action: "produce", outputOf: "rp-manufacturing",    resourceConformsTo: "goods",     resourceQuantity: { hasNumericalValue: 60,   hasUnit: "unit"  }, inScopeOf: ["commune-workshop"] },
    { id: "pi-olive-oil",      action: "produce", outputOf: "rp-olive-pressing",   resourceConformsTo: "olive-oil", resourceQuantity: { hasNumericalValue: 100,  hasUnit: "liter" }, inScopeOf: ["commune-olive"]    },
    { id: "pi-citrus-citrus",  action: "produce", outputOf: "rp-citrus-harvest",   resourceConformsTo: "citrus",    resourceQuantity: { hasNumericalValue: 150,  hasUnit: "kg"    }, inScopeOf: ["commune-citrus"]   },
    // Processors — produce output from inputs sourced via lateral matching
    { id: "pi-mill-flour",     action: "produce", outputOf: "rp-flour-sifting",    resourceConformsTo: "flour",     resourceQuantity: { hasNumericalValue: 160,  hasUnit: "kg"    }, inScopeOf: ["commune-mill"]     },
    { id: "pi-bakery-bread",   action: "produce", outputOf: "rp-baking",           resourceConformsTo: "bread",     resourceQuantity: { hasNumericalValue: 200,  hasUnit: "loaf"  }, inScopeOf: ["commune-bakery"]   },
    { id: "pi-fisher-fish",    action: "produce", outputOf: "rp-fishing",          resourceConformsTo: "fish",      resourceQuantity: { hasNumericalValue: 80,   hasUnit: "kg"    }, inScopeOf: ["commune-fisher"]   },
    { id: "pi-salter-salt",    action: "produce", outputOf: "rp-salt-extraction",  resourceConformsTo: "salt",      resourceQuantity: { hasNumericalValue: 160,  hasUnit: "kg"    }, inScopeOf: ["commune-salter"]   },
  ];

  // Supply index = on-hand inventory + committed produce intents (Stratum 2a).
  // Phase B sees produce intents as forward-scheduled outputs → SurplusSignal generation.
  const supplyIndex = buildIndependentSupplyIndex(allInventory, produceIntents, [], emptyAgentIndex, new Map());

  // Reactive demand index — re-derives whenever demandIntents changes
  const demandIndex = $derived(buildIndependentDemandIndex(demandIntents, [], [], new Map()));

  // ---------------------------------------------------------------------------
  // planFederation — reactive, re-runs when demandIndex changes
  // ---------------------------------------------------------------------------

  const federationResult = $derived.by(() => planFederation(
    [
      "commune-grain", "commune-dairy", "commune-forge", "commune-workshop",
      "commune-olive", "commune-citrus", "commune-mill", "commune-bakery",
      "commune-fisher", "commune-salter",
      "agri-federation", "manufacturing-federation", "horticulture-federation",
      "food-processing-federation", "maritime-federation", "universal-commune",
    ],
    { from: new Date("2026-03-15"), to: new Date("2026-06-30") },
    {
      recipeStore,
      observer: combinedObserver,
      demandIndex,
      supplyIndex,
      parentOf: parentOfMap,
    },
  ));

  // ---------------------------------------------------------------------------
  // Hub analytics — coherence, self-sufficiency, net flows
  // ---------------------------------------------------------------------------

  // Leaf communes for each hub (direct members only; UC flattens all leaves)
  const federationLeaves: Record<string, string[]> = {
    "agri-federation": ["commune-grain", "commune-dairy"],
    "manufacturing-federation": ["commune-forge", "commune-workshop"],
    "horticulture-federation": ["commune-olive", "commune-citrus"],
    "food-processing-federation": ["commune-mill", "commune-bakery"],
    "maritime-federation": ["commune-fisher", "commune-salter"],
    "universal-commune": [
      "commune-grain", "commune-dairy", "commune-forge", "commune-workshop",
      "commune-olive", "commune-citrus", "commune-mill", "commune-bakery",
      "commune-fisher", "commune-salter",
    ],
  };
  const hubIds = new Set(Object.keys(federationLeaves));
  function isHub(id: string): boolean { return hubIds.has(id); }
  function getLeaves(hubId: string): string[] { return federationLeaves[hubId] ?? []; }

  // % of leaf deficits fully resolved
  function computeCoherence(hubId: string): number {
    const leaves = getLeaves(hubId);
    let total = 0, resolved = 0;
    for (const id of leaves) {
      for (const d of federationResult.byScope.get(id)?.deficits ?? []) {
        total++;
        if (d.shortfall === 0) resolved++;
      }
    }
    return total === 0 ? 1 : resolved / total;
  }

  // % of leaf deficits resolved by a scope WITHIN the same federation
  function computeSufficiency(hubId: string): number {
    if (hubId === "universal-commune") return 1;
    const leafSet = new Set(getLeaves(hubId));
    let total = 0, internal = 0;
    for (const id of leafSet) {
      for (const d of federationResult.byScope.get(id)?.deficits ?? []) {
        total++;
        const resolvers = d.resolvedAt ?? [];
        if (resolvers.length > 0 && resolvers.every((s) => leafSet.has(s))) internal++;
      }
    }
    return total === 0 ? 1 : internal / total;
  }

  // Aggregate net surplus pool across leaves (by spec)
  function computeSurplusPool(hubId: string): { specId: string; quantity: number }[] {
    const map = new Map<string, number>();
    for (const id of getLeaves(hubId)) {
      for (const s of federationResult.byScope.get(id)?.surplus ?? [])
        map.set(s.specId, (map.get(s.specId) ?? 0) + s.quantity);
    }
    return [...map.entries()].map(([specId, quantity]) => ({ specId, quantity }));
  }

  // External trade flows crossing federation boundary (or everything for UC)
  function computeNetFlows(hubId: string) {
    const leafSet = new Set(getLeaves(hubId));
    const exMap = new Map<string, number>();
    const imMap = new Map<string, number>();
    for (const t of federationResult.tradeProposals) {
      const fromIn = leafSet.has(t.fromScopeId);
      const toIn = leafSet.has(t.toScopeId);
      if (fromIn && !toIn) exMap.set(t.specId, (exMap.get(t.specId) ?? 0) + t.quantity);
      else if (!fromIn && toIn) imMap.set(t.specId, (imMap.get(t.specId) ?? 0) + t.quantity);
    }
    return {
      exports: [...exMap.entries()].map(([specId, qty]) => ({ specId, qty })),
      imports: [...imMap.entries()].map(([specId, qty]) => ({ specId, qty })),
    };
  }

  // Per-member health for a hub (green=surplus only, yellow=resolved deficit, red=unresolved)
  function computeMemberHealth(hubId: string) {
    return getLeaves(hubId).map((id) => {
      const r = federationResult.byScope.get(id);
      const unresolved = r?.deficits.filter((d) => d.shortfall > 0).length ?? 0;
      const resolved   = r?.deficits.filter((d) => d.shortfall === 0).length ?? 0;
      const surplus    = r?.surplus.length ?? 0;
      const status: "red" | "yellow" | "green" | "dim" =
        unresolved > 0 ? "red" : resolved > 0 ? "yellow" : surplus > 0 ? "green" : "dim";
      return { id, status };
    });
  }

  // Sub-federation health for universal-commune
  function computeFederationHealth() {
    return Object.keys(federationLeaves)
      .filter((id) => id !== "universal-commune")
      .map((fedId) => {
        const coherence   = computeCoherence(fedId);
        const sufficiency = computeSufficiency(fedId);
        const flows       = computeNetFlows(fedId);
        return { fedId, coherence, sufficiency, exports: flows.exports, imports: flows.imports };
      });
  }

  function pct(n: number): string { return `${Math.round(n * 100)}%`; }
  function coherenceColor(n: number): string { return n >= 1 ? "#68d391" : n >= 0.8 ? "#d69e2e" : "#e53e3e"; }
  function sufficiencyColor(n: number): string { return n >= 0.8 ? "#68d391" : n >= 0.4 ? "#d69e2e" : "#b0c4f0"; }

  // ---------------------------------------------------------------------------
  // Proposal pruning
  // ---------------------------------------------------------------------------

  let rejectedTradeIds = $state(new Set<string>());
  function rejectTrade(id: string) { rejectedTradeIds = new Set([...rejectedTradeIds, id]); }
  function restoreTrade(id: string) { rejectedTradeIds = new Set([...rejectedTradeIds].filter(x => x !== id)); }

  const activeProposals = $derived(
    federationResult.tradeProposals.filter((t) => !rejectedTradeIds.has(t.id)),
  );

  // ---------------------------------------------------------------------------
  // Page state
  // ---------------------------------------------------------------------------

  let selectedScope = $state("");
  let mode = $state<"plan" | "observe">("plan");
  let selectedFlow  = $state<FlowSelectCtx | null>(null);
  let observerTick  = $state(0);

  const selectedResult = $derived(
    selectedScope ? federationResult.byScope.get(selectedScope) : undefined,
  );
  const selectedIsHub = $derived(isHub(selectedScope));
  const hubLeaves = $derived(selectedIsHub ? getLeaves(selectedScope) : []);
  const hubCoherence = $derived(selectedIsHub ? computeCoherence(selectedScope) : 0);
  const hubSufficiency = $derived(selectedIsHub ? computeSufficiency(selectedScope) : 0);
  const hubSurplus = $derived(selectedIsHub ? computeSurplusPool(selectedScope) : []);
  const hubFlows = $derived(selectedIsHub ? computeNetFlows(selectedScope) : { exports: [], imports: [] });
  const hubMemberHealth = $derived(selectedIsHub ? computeMemberHealth(selectedScope) : []);
  const hubFedHealth = $derived(selectedScope === "universal-commune" ? computeFederationHealth() : []);

  const outgoingTrades = $derived(
    activeProposals.filter((t) => t.fromScopeId === selectedScope),
  );
  const incomingTrades = $derived(
    activeProposals.filter((t) => t.toScopeId === selectedScope),
  );
  const hasTrades = $derived(outgoingTrades.length > 0 || incomingTrades.length > 0);

  function tradeStatusColor(status: TradeProposal["status"]): string {
    if (status === "settled") return "#7ee8a2";
    return "#76c3f5";
  }

  const totalScopes = $derived(federationResult.planOrder.length);
  const totalUnresolved = $derived(
    Array.from(federationResult.byScope.values()).reduce(
      (sum, r) => sum + r.deficits.filter((d) => d.shortfall > 0).length, 0,
    ),
  );
  const totalSurplusUnits = $derived(
    Array.from(federationResult.byScope.values()).reduce(
      (sum, r) => sum + r.surplus.reduce((s, x) => s + x.quantity, 0), 0,
    ),
  );
  const totalTrades = $derived(federationResult.tradeProposals.length);
  const fullyResolvedDeficits = $derived(
    Array.from(federationResult.byScope.values()).reduce((sum, r) => {
      return sum + r.deficits.filter(
        (d) => d.shortfall === 0 && (d.originalShortfall ?? d.shortfall) > 0,
      ).length;
    }, 0),
  );
  const allDeficits = $derived(
    Array.from(federationResult.byScope.values()).reduce(
      (sum, r) => sum + r.deficits.length, 0,
    ),
  );
  const resolvedPct = $derived(
    allDeficits > 0 ? Math.round((fullyResolvedDeficits / allDeficits) * 100) : 100,
  );

  // Scope proposals for selected scope (for proposals-band)
  const scopeProposals = $derived(
    selectedScope && !selectedIsHub
      ? federationResult.tradeProposals.filter(
          (t) => t.fromScopeId === selectedScope || t.toScopeId === selectedScope,
        )
      : [],
  );

  // ---------------------------------------------------------------------------
  // Claimable items
  // ---------------------------------------------------------------------------
  let myInventory = $state<EconomicResource[]>([]);
  const claimedIds = $derived(new Set(myInventory.map((r) => r.id)));
  const selectedClaimable = $derived(
    selectedScope
      ? (mockResources.get(selectedScope) ?? []).filter(
          (r) =>
            (r.classifiedAs?.includes("individual-claimable") ?? false) &&
            !claimedIds.has(r.id),
        )
      : [],
  );
  function claimItem(resource: EconomicResource) {
    myInventory = [...myInventory, resource];
  }

  // ---------------------------------------------------------------------------
  // Demand editor
  // ---------------------------------------------------------------------------

  const demandSpecs: ResourceSpecification[] = [
    { id: "bread",     name: "Bread",     image: "🍞", defaultUnitOfResource: "loaf", resourceClassifiedAs: ["individual-claimable"] },
    { id: "tools",     name: "Tools",     image: "🔧", defaultUnitOfResource: "unit", resourceClassifiedAs: ["individual-claimable"] },
    { id: "citrus",    name: "Citrus",    image: "🍊", defaultUnitOfResource: "kg",   resourceClassifiedAs: ["individual-claimable"] },
    { id: "salt",      name: "Salt",      image: "🧂", defaultUnitOfResource: "kg",   resourceClassifiedAs: ["individual-claimable"] },
    { id: "fish",      name: "Fish",      image: "🐟", defaultUnitOfResource: "kg" },
    { id: "wheat",     name: "Wheat",     image: "🌾", defaultUnitOfResource: "kg" },
    { id: "dairy",     name: "Dairy",     image: "🥛", defaultUnitOfResource: "kg" },
    { id: "flour",     name: "Flour",     image: "🌿", defaultUnitOfResource: "kg" },
    { id: "olive-oil", name: "Olive Oil", image: "🫒", defaultUnitOfResource: "liter" },
    { id: "goods",     name: "Goods",     image: "📦", defaultUnitOfResource: "unit" },
  ];
  const demandSpecMap = new Map(demandSpecs.map(s => [s.id, s]));

  // Group supply slots by spec_id for the selected scope
  const scopeSupply = $derived.by(() => {
    if (!selectedScope) return new Map<string, { onhand: number; scheduled: number; unit: string }>();
    const slots = querySupplyByScope(supplyIndex, selectedScope);
    const map = new Map<string, { onhand: number; scheduled: number; unit: string }>();
    for (const slot of slots) {
      if (!slot.spec_id || slot.quantity === 0) continue;
      const entry = map.get(slot.spec_id) ?? { onhand: 0, scheduled: 0, unit: '' };
      if (slot.slot_type === 'inventory') entry.onhand += slot.quantity;
      else if (slot.slot_type === 'scheduled_receipt') entry.scheduled += slot.quantity;
      if (!entry.unit) entry.unit = demandSpecMap.get(slot.spec_id)?.defaultUnitOfResource ?? '';
      map.set(slot.spec_id, entry);
    }
    return map;
  });

  let demandIdCounter = $state(1000);

  const scopeDemandIntents = $derived(
    demandIntents.filter(i => i.inScopeOf?.includes(selectedScope))
  );

  const scopeDemandsBySpec = $derived(
    scopeDemandIntents.reduce((m, i) => {
      const arr = m.get(i.resourceConformsTo ?? '') ?? [];
      m.set(i.resourceConformsTo ?? '', [...arr, i]);
      return m;
    }, new Map<string, Intent[]>())
  );

  const demandSpecsForScope = $derived(
    [...scopeDemandsBySpec.keys()]
      .map(id => demandSpecMap.get(id))
      .filter((s): s is ResourceSpecification => !!s)
  );

  function addDemand(specId: string) {
    const spec = demandSpecMap.get(specId);
    if (!spec || !selectedScope) return;
    const id = `ui-${demandIdCounter++}`;
    demandIntents = [...demandIntents, {
      id,
      action: 'transfer',
      resourceConformsTo: specId,
      resourceQuantity: { hasNumericalValue: 1, hasUnit: spec.defaultUnitOfResource ?? 'units' },
      inScopeOf: [selectedScope],
      due: '2026-04-01',
    }];
  }

  function updateDemand(intent: Intent) {
    demandIntents = demandIntents.map(i => i.id === intent.id ? intent : i);
  }

  function deleteDemand(id: string) {
    demandIntents = demandIntents.filter(i => i.id !== id);
  }

  let newSpecId = $state('');
  function addDemandCard() {
    if (!newSpecId) return;
    if (!scopeDemandsBySpec.has(newSpecId)) {
      addDemand(newSpecId);
    }
    newSpecId = '';
  }
</script>

<div class="page">
  <!-- Header stat bar -->
  <header class="stat-bar">
    <div class="page-title">
      <span class="title-label">FEDERATION PLANNING</span>
    </div>
  </header>

  <!-- Proposals band — visible for leaf communes with pending proposals -->
  {#if scopeProposals.length > 0}
    <div class="proposals-band">
      <span class="proposals-lbl">PROPOSALS</span>
      <div class="proposals-scroll">
        {#each scopeProposals as t (t.id)}
          {@const rejected = rejectedTradeIds.has(t.id)}
          <button
            class="proposal-chip"
            class:rejected
            onclick={() => (rejected ? restoreTrade(t.id) : rejectTrade(t.id))}
            title={rejected ? "Restore proposal" : "Reject proposal"}
          >
            <span class="proposal-spec">{specNames[t.specId] ?? t.specId}</span>
            <span class="proposal-qty">×{t.quantity}</span>
            <span class="proposal-arrow">{t.fromScopeId === selectedScope ? "→" : "←"}</span>
            <span class="proposal-peer">{t.fromScopeId === selectedScope ? t.toScopeId : t.fromScopeId}</span>
            <span class="proposal-x">{rejected ? "↺" : "✕"}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Main body: event log + graph, full width -->
  <div class="body">
    <FederationEventLog events={federationResult.events} />
    <div class="graph-wrap">
      <FederationGraphView
        planOrder={federationResult.planOrder}
        byScope={federationResult.byScope}
        parentOf={mockParentOf}
        tradeProposals={activeProposals}
        resourcesByScope={mockResources}
        selected={selectedScope}
        onselect={(id) => {
          selectedScope = selectedScope === id ? "" : id;
          selectedFlow  = null;
        }}
      />
    </div>
  </div>

  <!-- Network diagram band — only for leaf communes (hubs have empty plan stores) -->
  {#if selectedScope && selectedResult && !selectedIsHub}
    <div class="network-band">
      <div class="network-band-head">
        <span class="band-lbl">NETWORK</span>
        <span class="band-val">{selectedScope}</span>
        <div class="mode-tabs">
          <button
            class="tab-btn"
            class:active={mode === "plan"}
            onclick={() => { mode = "plan"; selectedFlow = null; }}>PLAN</button
          >
          <button
            class="tab-btn"
            class:active={mode === "observe"}
            onclick={() => (mode = "observe")}>OBSERVE</button
          >
        </div>
      </div>
      <div class="network-body">
        <div class="network-diagram-wrap">
          <ScopeNetworkDiagram
            planStore={selectedResult.planStore}
            observer={combinedObserver}
            {specNames}
            {mode}
            bufferZones={mockBufferZones.get(selectedScope) ?? []}
            capacityBuffers={[]}
            {observerTick}
            onflowselect={(ctx) => (selectedFlow = ctx)}
          />
        </div>
        <div class="recipes-panel-wrap">
          <ScopeRecipesPanel scopeId={selectedScope} {recipeStore} {specNames} />
        </div>
        {#if selectedFlow}
          <div class="observe-panel">
            <EventRecorderPanel
              context={selectedFlow}
              observer={combinedObserver}
              onrecord={() => { observerTick++; selectedFlow = null; }}
              onclose={() => (selectedFlow = null)}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if selectedScope && selectedResult && !selectedIsHub}
    <div class="demands-band">
      <div class="demands-head">
        <span class="band-lbl">DEMANDS · {selectedScope}</span>
        <span class="demands-count">{scopeDemandIntents.length} intent{scopeDemandIntents.length !== 1 ? 's' : ''}</span>
        <select class="spec-picker" bind:value={newSpecId} onchange={addDemandCard}>
          <option value="">+ add spec…</option>
          {#each demandSpecs as s (s.id)}
            <option value={s.id}>{s.image ?? ''} {s.name}</option>
          {/each}
        </select>
      </div>
      <div class="demands-body">
        <!-- Supply column -->
        <div class="supply-col">
          <span class="supply-col-lbl">SUPPLY</span>
          {#each [...scopeSupply.entries()] as [specId, entry] (specId)}
            {@const spec = demandSpecMap.get(specId)}
            <div class="supply-row">
              <span class="supply-emoji">{spec?.image ?? '📦'}</span>
              <span class="supply-name">{spec?.name ?? specId}</span>
              <span class="supply-qty onhand">{entry.onhand}</span>
              {#if entry.scheduled > 0}
                <span class="supply-qty scheduled">+{entry.scheduled}</span>
              {/if}
              <span class="supply-unit">{entry.unit}</span>
            </div>
          {/each}
          {#if scopeSupply.size === 0}
            <span class="supply-empty">—</span>
          {/if}
          {#if selectedResult.deficits.length > 0}
            <span class="supply-col-lbl" style="margin-top:6px">DEFICITS</span>
            {#each selectedResult.deficits as d (d.intentId)}
              {@const orig = d.originalShortfall ?? d.shortfall}
              {@const pctRes = orig > 0 ? Math.round(((orig - d.shortfall) / orig) * 100) : 100}
              {@const spec = demandSpecMap.get(d.specId)}
              <div class="supply-row">
                <span class="supply-emoji">{spec?.image ?? '⚠️'}</span>
                <span class="supply-name">{spec?.name ?? d.specId}</span>
                <span class="supply-qty" style="color:{pctRes === 100 ? '#68d391' : '#fc5858'}">{d.shortfall === 0 ? '✓' : d.shortfall}</span>
                {#if d.shortfall > 0}
                  <span class="supply-unit">{spec?.defaultUnitOfResource ?? ''}</span>
                {/if}
                {#if d.resolvedAt?.length && d.shortfall === 0}
                  <span class="supply-unit" style="color:rgba(118,195,245,0.6)">{d.resolvedAt[0]}</span>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
        <!-- Demand cards -->
        <div class="demands-scroll">
          {#each demandSpecsForScope as spec (spec.id)}
            <ResourceDemandCard
              {spec}
              compact
              intents={scopeDemandsBySpec.get(spec.id) ?? []}
              onAddDemand={() => addDemand(spec.id)}
              onUpdate={updateDemand}
              onDelete={deleteDemand}
            />
          {/each}
          {#if demandSpecsForScope.length === 0}
            <span class="demands-empty">No demands set for this scope. Use the picker to add one.</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if selectedScope && selectedClaimable.length > 0}
    <div class="claimable-band">
      <div class="band-lbl">CLAIMABLE · {selectedScope}</div>
      <div class="claimable-scroll">
        {#each selectedClaimable as r (r.id)}
          <button class="claim-card" onclick={() => claimItem(r)}>
            <div class="claim-name">{r.name ?? specNames[r.conformsTo] ?? r.conformsTo}</div>
            <div class="claim-qty">{r.onhandQuantity?.hasNumericalValue ?? '—'} {r.onhandQuantity?.hasUnit ?? ''}</div>
            <div class="claim-action">CLAIM</div>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <InventoryBand allResources={mockResources} {specNames} {selectedScope} myResources={myInventory} />
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-base);
    color: rgba(228, 238, 255, 0.92);
    font-family: var(--font-mono);
    overflow: hidden;
  }

  /* ---- Stat bar ---- */
  .stat-bar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .page-title {
    margin-right: auto;
  }

  .title-label {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.85;
  }

  .stats {
    display: flex;
    gap: 28px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1;
  }

  .stat-value.red {
    color: #fc5858;
  }
  .stat-value.green {
    color: #7ee8a2;
  }
  .stat-value.blue {
    color: #76c3f5;
  }
  .stat-value.yellow {
    color: #e8b04e;
  }

  .stat-label {
    font-size: 0.52rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.68;
  }

  /* ---- Body ---- */
  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .graph-wrap {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: flex;
  }

  /* ---- Shared band primitives ---- */
  .band-lbl {
    font-size: 0.5rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.62;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .band-val {
    font-size: 0.68rem;
    color: rgba(228, 238, 255, 0.96);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .green {
    color: #7ee8a2;
  }
  .yellow {
    color: #e8b04e;
  }
  .blue {
    color: #76c3f5;
  }

  /* ---- Network diagram band (above inventory) ---- */
  .network-band {
    flex-shrink: 0;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
  }

  .network-body {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    overflow: hidden;
  }

  .observe-panel {
    flex-shrink: 0;
    width: 320px;
    padding: 12px 16px;
    border-left: 1px solid var(--border-faint);
    overflow-y: auto;
  }

  .network-band-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .network-diagram-wrap {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 16px;
  }

  /* ---- Mode tabs ---- */
  .mode-tabs {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }

  .tab-btn {
    background: none;
    border: 1px solid var(--border-dim);
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 3px;
    transition:
      color 0.15s,
      border-color 0.15s,
      background 0.15s;
  }

  .tab-btn:hover {
    color: rgba(255, 255, 255, 0.7);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .tab-btn.active {
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.35);
    background: var(--border-faint);
  }

  /* ---- Claimable band ---- */
  .claimable-band {
    display: flex;
    flex-direction: row;
    height: 110px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-base);
    flex-shrink: 0;
    overflow: hidden;
  }

  .claimable-band > .band-lbl {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.55;
    padding: 8px 6px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 1px solid var(--border-faint);
    color: #e8b04e;
  }

  .claimable-scroll {
    display: flex;
    flex-direction: row;
    gap: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    align-items: center;
    scrollbar-width: thin;
    flex: 1;
    min-width: 0;
  }

  .claim-card {
    width: 120px;
    height: 86px;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: rgba(232, 176, 78, 0.06);
    border: 1px solid rgba(232, 176, 78, 0.25);
    border-radius: 3px;
    padding: 5px 7px;
    gap: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    font-family: var(--font-mono);
    text-align: left;
  }

  .claim-card:hover {
    border-color: rgba(232, 176, 78, 0.55);
    background: rgba(232, 176, 78, 0.12);
  }

  .claim-name {
    font-size: 0.6rem;
    font-weight: 600;
    color: rgba(228, 238, 255, 0.96);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .claim-qty {
    font-size: 0.55rem;
    color: #e8b04e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .claim-action {
    font-size: 0.48rem;
    letter-spacing: 0.1em;
    color: #e8b04e;
    border: 1px solid rgba(232, 176, 78, 0.4);
    border-radius: 2px;
    padding: 1px 5px;
    text-align: center;
    flex-shrink: 0;
  }

  .claim-card:hover .claim-action {
    background: rgba(232, 176, 78, 0.15);
    border-color: rgba(232, 176, 78, 0.7);
  }

  /* ---- Proposals band ---- */
  .proposals-band {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 36px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-surface);
    overflow: hidden;
  }

  .proposals-lbl {
    font-size: 0.5rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.62;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .proposals-scroll {
    display: flex;
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
    align-items: center;
    scrollbar-width: thin;
    flex: 1;
    min-width: 0;
    padding: 2px 0;
  }

  .proposal-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.56rem;
    padding: 2px 7px;
    border: 1px solid rgba(118, 195, 245, 0.35);
    border-radius: 3px;
    white-space: nowrap;
    flex-shrink: 0;
    background: rgba(118, 195, 245, 0.06);
    cursor: pointer;
    font-family: var(--font-mono);
    color: rgba(228, 238, 255, 0.9);
    transition: background 0.12s, border-color 0.12s, opacity 0.12s;
  }

  .proposal-chip:hover {
    background: rgba(118, 195, 245, 0.14);
    border-color: rgba(118, 195, 245, 0.6);
  }

  .proposal-chip.rejected {
    opacity: 0.4;
    text-decoration: line-through;
    border-color: rgba(255, 100, 100, 0.3);
    background: rgba(255, 100, 100, 0.04);
  }

  .proposal-chip.rejected:hover {
    opacity: 0.7;
    text-decoration: none;
  }

  .proposal-spec { color: rgba(210, 228, 255, 0.88); }
  .proposal-qty { color: #76c3f5; font-weight: 600; }
  .proposal-arrow { font-size: 0.62rem; opacity: 0.7; }
  .proposal-peer { color: rgba(180, 205, 255, 0.65); font-size: 0.5rem; }
  .proposal-x { font-size: 0.55rem; opacity: 0.6; margin-left: 2px; }

  /* ---- Recipes panel in network-band ---- */
  .recipes-panel-wrap {
    width: 260px;
    flex-shrink: 0;
    border-left: 1px solid var(--border-faint);
    overflow-y: auto;
    padding: 8px 12px;
    max-height: 240px;
  }

  /* ---- Demands band ---- */
  .demands-band {
    flex-shrink: 0;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-surface);
    max-height: 280px;
    display: flex;
    flex-direction: column;
  }

  .demands-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .demands-count {
    font-size: 0.6rem;
    opacity: 0.55;
  }

  .spec-picker {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    background: var(--bg-overlay);
    border: 1px solid var(--border-dim);
    color: rgba(228,238,255,0.7);
    border-radius: 3px;
    padding: 2px 6px;
    cursor: pointer;
  }

  .demands-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .supply-col {
    flex-shrink: 0;
    width: 160px;
    border-right: 1px solid var(--border-faint);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
  }

  .supply-col-lbl {
    font-size: 0.48rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.45;
    margin-bottom: 2px;
    flex-shrink: 0;
  }

  .supply-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-size: 0.6rem;
    white-space: nowrap;
  }

  .supply-emoji { font-size: 0.7rem; flex-shrink: 0; }

  .supply-name {
    flex: 1;
    color: rgba(210, 228, 255, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .supply-qty {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 600;
  }

  .supply-qty.onhand  { color: #68d391; }
  .supply-qty.scheduled { color: rgba(99, 179, 237, 0.75); }

  .supply-unit {
    font-size: 0.52rem;
    color: rgba(167, 139, 250, 0.55);
  }

  .supply-empty {
    font-size: 0.6rem;
    opacity: 0.35;
  }

  .demands-scroll {
    display: flex;
    gap: 12px;
    padding: 10px 14px;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    min-height: 0;
    align-items: flex-start;
  }

  .demands-empty {
    font-size: 0.6rem;
    opacity: 0.45;
    align-self: center;
  }
</style>
