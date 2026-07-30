import { renderIcon } from './icon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Renders at 180 for real, rather than shipping a 512 image labelled 180. */
export default function AppleIcon() {
  return renderIcon(size.width);
}
