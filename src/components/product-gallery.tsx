import Image from "next/image";
import { Decimal } from "decimal.js";

export function ProductGallery({
  products,
}: {
  products: {
    id: string;
    name: string;
    packGrams: string;
    cartonCapacity: number;
    hasPrice?: boolean;
    hasBom?: boolean;
  }[];
}) {
  if (!products.length) return null;
  const imageFor = (name: string) => {
    const value = name.toLowerCase();
    if (value.includes("murukku"))
      return { src: "murukku", alt: "Golden spiral murukku on a black plate" };
    if (value.includes("mixture"))
      return {
        src: "mixture",
        alt: "South Indian snack mixture on a black plate",
      };
    if (value.includes("chips"))
      return { src: "chips", alt: "Golden banana chips on a black plate" };
    if (value.includes("sweet"))
      return {
        src: "sweets",
        alt: "Illustrative South Indian sweets on a black plate",
      };
    return null;
  };
  return (
    <div className="product-grid" aria-label="Product overview">
      {products.map((product) => (
        <article className="product-card" key={product.id}>
          {imageFor(product.name) ? (
            <div className="product-photo">
              <Image
                src={`/images/${imageFor(product.name)!.src}.webp`}
                alt={imageFor(product.name)!.alt}
                width={640}
                height={640}
                unoptimized
              />
              <span>Illustrative image</span>
            </div>
          ) : (
            <div className="product-placeholder" aria-hidden="true">
              {product.name.slice(0, 1)}
            </div>
          )}
          <div className="product-card-body">
            <span className="eyebrow">FINISHED PRODUCT</span>
            <h2>{product.name}</h2>
            <p className="catalog-setup">
              {product.hasPrice && product.hasBom
                ? "Price and BOM configured"
                : `Needs ${[!product.hasPrice && "price", !product.hasBom && "BOM"].filter(Boolean).join(" and ")} configuration`}
            </p>
            <p>
              {new Decimal(product.packGrams).toFixed()} g per packet{" "}
              <span aria-hidden="true">/</span> {product.cartonCapacity} packets
              per carton
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
