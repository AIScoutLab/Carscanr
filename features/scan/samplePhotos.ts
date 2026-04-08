export const sampleScanPhotos = [
  {
    id: "2022-tesla-model-3-long-range",
    title: "2022 Tesla Model 3",
    subtitle: "Clean front three-quarter angle",
    previewUrl: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "2019-ford-mustang-gt",
    title: "2019 Ford Mustang GT",
    subtitle: "Performance coupe profile",
    previewUrl: "https://images.unsplash.com/photo-1494905998402-395d579af36f?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "2023-harley-davidson-street-glide-special",
    title: "2023 Street Glide Special",
    subtitle: "Touring bike with visible fairing",
    previewUrl: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=80",
  },
] as const;

export type SampleScanPhotoSeed = (typeof sampleScanPhotos)[number];
