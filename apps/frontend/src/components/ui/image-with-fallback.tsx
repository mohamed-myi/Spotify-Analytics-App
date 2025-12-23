"use client";

/* eslint-disable @next/next/no-img-element */
// This component intentionally uses native <img> for onError fallback handling,
// which is not supported by Next.js Image component.

import React, { useState } from 'react';

const ERROR_IMG_SRC =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjZmZmIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4=';

interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    fallbackClassName?: string;
}

export function ImageWithFallback({
    src,
    alt,
    style,
    className,
    fallbackClassName,
    ...rest
}: ImageWithFallbackProps) {
    const [didError, setDidError] = useState(false);

    const handleError = () => {
        setDidError(true);
    };

    if (didError) {
        return (
            <div
                className={`inline-block bg-white/5 text-center align-middle ${fallbackClassName ?? className ?? ''}`}
                style={style}
            >
                <div className="flex items-center justify-center w-full h-full">
                    <img
                        src={ERROR_IMG_SRC}
                        alt="Error loading image"
                        className="w-12 h-12 opacity-30"
                        {...rest}
                        data-original-url={src}
                    />
                </div>
            </div>
        );
    }

    return (
        <img
            src={src}
            alt={alt}
            className={className}
            style={style}
            {...rest}
            onError={handleError}
        />
    );
}
