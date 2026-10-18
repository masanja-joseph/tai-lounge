import React from 'react';

interface Props {
  url?: string | null;
  name: string;
  className?: string;
  size?: number;
}

export default function BrandLogo({ url, name, className, size = 100 }: Props) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{ width: size, height: 'auto' }}
        className={className}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
          (e.target.nextElementSibling as HTMLElement).style.display = 'block';
        }}
      />
    );
  }
  return <h1 className={`font-bold text-slate-100 ${className}`}>{name}</h1>;
}
