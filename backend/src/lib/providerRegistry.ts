import { env } from "../config/env.js";
import { VehicleListingsProvider, VehicleSpecsProvider, VehicleValueProvider, VisionProvider } from "../providers/interfaces.js";
import { MockVehicleListingsProvider } from "../providers/mock/mockVehicleListingsProvider.js";
import { MockVehicleSpecsProvider } from "../providers/mock/mockVehicleSpecsProvider.js";
import { MockVehicleValueProvider } from "../providers/mock/mockVehicleValueProvider.js";
import { MockVisionProvider } from "../providers/mock/mockVisionProvider.js";
import { OpenAIVisionProvider } from "../providers/openai/openAIVisionProvider.js";
import { MarketCheckVehicleDataProvider } from "../providers/marketcheck/marketCheckVehicleDataProvider.js";

const mockVisionProvider = new MockVisionProvider();

export type ProviderRegistry = {
  visionProvider: VisionProvider;
  fallbackVisionProvider: VisionProvider;
  specsProvider: VehicleSpecsProvider;
  valueProvider: VehicleValueProvider;
  listingsProvider: VehicleListingsProvider;
  specsProviderName: string;
  valueProviderName: string;
  listingsProviderName: string;
};

function createDefaultProviders(): ProviderRegistry {
  const marketCheckProvider = new MarketCheckVehicleDataProvider();
  const useMarketCheckSpecs = env.VEHICLE_SPECS_PROVIDER === "marketcheck" && Boolean(env.MARKETCHECK_API_KEY);
  const useMarketCheckValue = env.VEHICLE_VALUE_PROVIDER === "marketcheck" && Boolean(env.MARKETCHECK_API_KEY);
  const useMarketCheckListings = env.VEHICLE_LISTINGS_PROVIDER === "marketcheck" && Boolean(env.MARKETCHECK_API_KEY);

  return {
    visionProvider: env.VISION_PROVIDER === "openai" ? new OpenAIVisionProvider() : mockVisionProvider,
    fallbackVisionProvider: mockVisionProvider,
    specsProvider: useMarketCheckSpecs ? marketCheckProvider : new MockVehicleSpecsProvider(),
    valueProvider: useMarketCheckValue ? marketCheckProvider : new MockVehicleValueProvider(),
    listingsProvider: useMarketCheckListings ? marketCheckProvider : new MockVehicleListingsProvider(),
    specsProviderName: useMarketCheckSpecs ? "marketcheck" : "mock",
    valueProviderName: useMarketCheckValue ? "marketcheck" : "mock",
    listingsProviderName: useMarketCheckListings ? "marketcheck" : "mock",
  };
}

export let providers: ProviderRegistry = createDefaultProviders();

export function setProviders(nextProviders: ProviderRegistry) {
  providers = nextProviders;
}

export function resetProviders() {
  providers = createDefaultProviders();
}
