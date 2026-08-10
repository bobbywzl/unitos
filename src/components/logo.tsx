import Image from "next/image";

// The Dissect mark. White tile so the line art reads on dark backgrounds too.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="Dissect"
      width={size}
      height={size}
      className="rounded-md"
      priority
    />
  );
}
