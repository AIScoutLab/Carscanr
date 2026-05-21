type SampleVehicleType = "car" | "truck" | "motorcycle";

type SampleSpecsSeed = {
  bodyStyle: string;
  vehicleType: SampleVehicleType;
  msrp: number;
  engine: string;
  horsepower: number | null;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  exteriorColors: string[];
};

type SampleValuationSeed = {
  mileage: number;
  tradeIn: number;
  privateParty: number;
  dealerRetail: number;
};

type SampleListingSeed = {
  id: string;
  title: string;
  price?: number | null;
  mileage?: number | null;
  dealer?: string | null;
  distanceMiles?: number | null;
  location?: string | null;
};

export const sampleScanPhotos = [
  {
    id: "2022-tesla-model-3-long-range",
    title: "2022 Tesla Model 3",
    subtitle: "Clean front three-quarter angle",
    previewUrl: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1200&q=80",
    year: 2022,
    make: "Tesla",
    model: "Model 3",
    trim: "Long Range",
    specs: {
      bodyStyle: "Sedan",
      vehicleType: "car",
      msrp: 50990,
      engine: "Dual Motor Electric",
      horsepower: 449,
      torque: "389 lb-ft est.",
      transmission: "Single-speed",
      drivetrain: "AWD",
      mpgOrRange: "358 miles EPA est.",
      exteriorColors: ["Pearl White Multi-Coat", "Solid Black", "Deep Blue Metallic"],
    },
    demoValue: {
      mileage: 18400,
      tradeIn: 33200,
      privateParty: 34950,
      dealerRetail: 36750,
    },
    demoListings: [
      {
        id: "sample-listing-model3-1",
        title: "2022 Tesla Model 3 Long Range",
        price: 35990,
        mileage: 21404,
        dealer: "Lakefront EV",
        distanceMiles: 7,
        location: "Chicago, IL",
      },
      {
        id: "sample-listing-model3-2",
        title: "2022 Tesla Model 3 Long Range AWD",
        price: 34850,
        mileage: 26210,
        dealer: "Naperville EV Center",
        distanceMiles: 22,
        location: "Naperville, IL",
      },
    ],
  },
  {
    id: "2019-ford-mustang-gt",
    title: "2019 Ford Mustang GT",
    subtitle: "Performance coupe profile",
    previewUrl: "https://images.unsplash.com/photo-1494905998402-395d579af36f?auto=format&fit=crop&w=1200&q=80",
    year: 2019,
    make: "Ford",
    model: "Mustang",
    trim: "GT",
    specs: {
      bodyStyle: "Coupe",
      vehicleType: "car",
      msrp: 35995,
      engine: "5.0L V8",
      horsepower: 460,
      torque: "420 lb-ft",
      transmission: "6-speed Manual",
      drivetrain: "RWD",
      mpgOrRange: "15 city / 24 hwy",
      exteriorColors: ["Race Red", "Shadow Black", "Velocity Blue"],
    },
    demoValue: {
      mileage: 30118,
      tradeIn: 31600,
      privateParty: 33250,
      dealerRetail: 34995,
    },
    demoListings: [
      {
        id: "sample-listing-mustang-1",
        title: "2019 Ford Mustang GT Premium",
        price: 33850,
        mileage: 30118,
        dealer: "North Avenue Performance",
        distanceMiles: 13,
        location: "Elmhurst, IL",
      },
      {
        id: "sample-listing-mustang-2",
        title: "2019 Ford Mustang GT",
        price: 32995,
        mileage: 35244,
        dealer: "West Suburban Ford",
        distanceMiles: 26,
        location: "St. Charles, IL",
      },
    ],
  },
  {
    id: "2023-harley-davidson-street-glide-special",
    title: "2023 Street Glide Special",
    subtitle: "Touring bike with visible fairing",
    previewUrl: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=80",
    year: 2023,
    make: "Harley-Davidson",
    model: "Street Glide",
    trim: "Special",
    specs: {
      bodyStyle: "Touring Motorcycle",
      vehicleType: "motorcycle",
      msrp: 30399,
      engine: "Milwaukee-Eight 114 V-Twin",
      horsepower: 95,
      torque: "122 lb-ft",
      transmission: "6-speed Manual",
      drivetrain: "Belt",
      mpgOrRange: "43 mpg est.",
      exteriorColors: ["Vivid Black", "Redline Red", "White Sand Pearl"],
    },
    demoValue: {
      mileage: 4188,
      tradeIn: 26950,
      privateParty: 28250,
      dealerRetail: 29495,
    },
    demoListings: [
      {
        id: "sample-listing-street-glide-1",
        title: "2023 Harley-Davidson Street Glide Special",
        price: 28695,
        mileage: 4188,
        dealer: "Windy City Harley",
        distanceMiles: 18,
        location: "Rosemont, IL",
      },
      {
        id: "sample-listing-street-glide-2",
        title: "2023 Harley-Davidson Street Glide Special",
        price: 29250,
        mileage: 5220,
        dealer: "Fox River Harley-Davidson",
        distanceMiles: 31,
        location: "St. Charles, IL",
      },
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  subtitle: string;
  previewUrl: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  specs: SampleSpecsSeed;
  demoValue: SampleValuationSeed;
  demoListings: readonly SampleListingSeed[];
}>;

export type SampleScanPhotoSeed = (typeof sampleScanPhotos)[number];

export function getSampleVehicleRouteId(sampleId: string) {
  return `${sampleId}-sample`;
}

export function isSampleVehicleRouteId(id: string | null | undefined) {
  const normalized = String(id ?? "").trim();
  return normalized.endsWith("-sample") && sampleScanPhotos.some((entry) => getSampleVehicleRouteId(entry.id) === normalized);
}

export function findSampleScanPhoto(sampleIdOrRouteId: string | null | undefined) {
  const normalized = String(sampleIdOrRouteId ?? "").trim();
  if (!normalized) {
    return null;
  }
  return sampleScanPhotos.find((entry) => entry.id === normalized || getSampleVehicleRouteId(entry.id) === normalized) ?? null;
}
