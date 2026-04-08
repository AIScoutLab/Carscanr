import { GarageItem } from "@/types";

export function filterGarageItems(items: GarageItem[], query: string, favoritesOnly: boolean) {
  return items.filter((item) => {
    const matchesSearch = `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model} ${item.vehicle.trim}`
      .toLowerCase()
      .includes(query.toLowerCase());
    return matchesSearch && (!favoritesOnly || item.favorite);
  });
}
