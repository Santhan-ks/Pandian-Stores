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
  }[];
}) {
  if (!products.length) return null;
  return (
    <div className="product-grid" aria-label="Product overview">
      {products.map((product) => (
        <article className="product-card" key={product.id}>
          {product.name.toLowerCase().includes("murukku") ? (
            <div className="product-photo">
              <Image
                src="/images/murukku.webp"
                alt="Golden spiral murukku on a black plate"
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
