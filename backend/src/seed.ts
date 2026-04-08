import { seedListings, seedValuations, seedVehicles } from "./data/seedVehicles.js";

console.log(
  JSON.stringify(
    {
      vehicles: seedVehicles,
      valuations: seedValuations,
      listings: seedListings,
    },
    null,
    2,
  ),
);
