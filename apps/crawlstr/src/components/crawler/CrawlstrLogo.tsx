import { cn } from '@/lib/utils';

export interface CrawlstrLogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Gently pulse the logo while the crawler is active. */
  animated?: boolean;
}

/**
 * The Crawlstr mark — a spider sitting in its web.
 *
 * Renders the brand artwork (public/brand/logo.png) used everywhere else:
 * favicon, PWA icons, manifest, README. One source of truth, one file.
 *
 * Note the artwork ships on a dark tile by design, so it renders identically
 * in light and dark mode.
 */
export function CrawlstrLogo({ animated = false, className, alt = 'Crawlstr', ...props }: CrawlstrLogoProps) {
  return (
    <img
      src="/brand/logo.png"
      alt={alt}
      draggable={false}
      className={cn(
        'shrink-0 select-none rounded-lg',
        animated && 'motion-safe:animate-pulse',
        className,
      )}
      {...props}
    />
  );
}
