import {
  Apple, Baby, Beef, Bike, Book, Cake, Car, Carrot, Cat, Coffee, Croissant, Drill, Flower2, Gem, Gift, Glasses,
  Hammer, HeartPulse, Laptop, Milk, Package, Paintbrush, Pencil, Pill, Scissors, Shirt, ShoppingBasket,
  ShoppingCart, Smartphone, Sofa, Sparkles, Store, Utensils, Watch, Wrench, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Icons a category can use when it has no photo. Names are saved as-is for the apps. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ShoppingBasket, ShoppingCart, Store, Package, Apple, Carrot, Milk, Cake, Croissant, Coffee, Beef, Utensils,
  Pill, HeartPulse, Book, Pencil, Smartphone, Laptop, Zap, Hammer, Wrench, Drill, Shirt, Watch, Glasses, Gem,
  Gift, Flower2, Sofa, Scissors, Paintbrush, Sparkles, Baby, Cat, Car, Bike,
};
export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);
