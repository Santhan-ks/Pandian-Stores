import Image from "next/image";
import { businessName } from "@/lib/brand";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <Image
        src="/images/pandian-stores-logo.svg"
        alt=""
        width={48}
        height={48}
        unoptimized
      />
      {!compact && (
        <span className="brand-wordmark">
          {businessName}
          <small>MANUFACTURING WORKSPACE</small>
        </span>
      )}
    </span>
  );
}
