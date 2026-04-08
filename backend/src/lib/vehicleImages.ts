export const seededVehicleImages = {
  "2021-cadillac-ct4-premium-luxury": "https://commons.wikimedia.org/wiki/Special:FilePath/2020_Cadillac_CT4.jpg",
  "2020-honda-civic-ex": "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Honda_Civic_LX_Sedan_in_Modern_Steel_Metallic%2C_front_left%2C_2024-10-28.jpg",
  "2018-kia-optima-ex": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1200&q=80",
  "2019-ford-mustang-gt": "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Ford_Mustang_GT_5.0_facelift_Side.jpg",
  "2022-tesla-model-3-long-range": "https://commons.wikimedia.org/wiki/Special:FilePath/Tesla_Model_3_%2852304163995%29.jpg",
  "2021-yamaha-yzf-r3-standard": "https://commons.wikimedia.org/wiki/Special:FilePath/5-YZF_R3_2021.jpg",
  "2023-harley-davidson-street-glide-special": "https://commons.wikimedia.org/wiki/Special:FilePath/2015_Street_Glide_Special.jpg",
} as const;

const genericVehicleImages = {
  car: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80",
  motorcycle: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=900&q=80",
} as const;

export function getVehicleImage(vehicleId: string, vehicleType: "car" | "motorcycle" = "car") {
  return seededVehicleImages[vehicleId as keyof typeof seededVehicleImages] ?? genericVehicleImages[vehicleType];
}
