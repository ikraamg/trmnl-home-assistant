/**
 * Floyd-Steinberg Error Diffusion Dithering Strategy
 *
 * Implements Floyd-Steinberg algorithm for high-quality dithering.
 * Best visual quality but slowest performance (~2x slower than ordered).
 *
 * Algorithm Overview:
 * Error diffusion algorithm that distributes quantization errors to neighboring pixels.
 * When a pixel is rounded to nearest palette color, the rounding error propagates:
 * - 7/16 to pixel on right
 * - 3/16 to pixel below-left
 * - 5/16 to pixel below
 * - 1/16 to pixel below-right
 *
 * This creates natural-looking dither patterns without visible repetition.
 *
 * Use Cases:
 * - Photographic content (gradients, faces, natural scenes)
 * - Maximum quality when performance not critical
 * - Single-image processing (batch processing → use ordered dithering)
 *
 * Trade-offs:
 * ✓ Best quality: Smooth gradients, no visible patterns
 * ✓ Perceptually accurate: Preserves perceived brightness
 * ✗ Slow: Sequential pixel processing (can't parallelize)
 * ✗ Error accumulation: Errors can compound in large images
 *
 * GraphicsMagick Implementation:
 * Uses GM's .dither(true) which implements Floyd-Steinberg.
 * Combined with .monochrome() for binary or .colors(n) for multi-level.
 *
 * NOTE: Strategy is stateless - safe to reuse same instance.
 * AI: When optimizing, don't switch to ordered dithering without user testing.
 *
 * @class
 */
export class FloydSteinbergStrategy {
  /**
   * Creates Floyd-Steinberg strategy instance (stateless, no config needed).
   */
  constructor() {
    // Strategy is stateless - no configuration needed
  }

  /**
   * Applies Floyd-Steinberg dithering via GraphicsMagick.
   *
   * Mode-Specific Behavior:
   * - Grayscale + 2 colors: Binary B&W with error diffusion (.dither().monochrome())
   * - Grayscale + >2 colors: Multi-level gray with error diffusion (.dither().colors(n))
   * - Color: Full color palette with error diffusion (.dither() only)
   *
   * Binary vs. Multi-Level:
   * Binary (2 colors) uses .monochrome() - specialized for pure B&W.
   * Multi-level (>2 colors) uses .colors(n) - quantizes to N gray shades.
   * Both apply Floyd-Steinberg error diffusion for smooth transitions.
   *
   * Color Mode:
   * .dither(true) alone applies Floyd-Steinberg to full color palette.
   * Preserves color information while reducing color count.
   * Used when palette includes non-gray colors.
   *
   * Fallback:
   * Returns image unchanged if mode invalid or colors undefined.
   * Graceful degradation prevents pipeline breakage.
   *
   * Performance:
   * Binary: ~500ms for 800x600 image
   * Multi-level: ~800ms for 800x600 image
   * Color: ~1200ms for 800x600 image
   *
   * @param {Object} image - GraphicsMagick image instance (chainable)
   * @param {Object} options - Dithering configuration
   * @param {string} options.mode - 'grayscale' or 'color'
   * @param {number} [options.colors] - Number of colors (grayscale mode only)
   * @returns {Object} Modified GraphicsMagick image instance (chainable)
   */
  call(image, options = {}) {
    const { mode, colors } = options

    if (mode === 'grayscale') {
      // Grayscale Floyd-Steinberg
      if (colors === 2) {
        // Binary (black & white) with error diffusion
        return image.dither(true).monochrome()
      } else if (colors > 2) {
        // Multi-level grayscale with error diffusion
        return image.dither(true).colors(colors)
      }
    } else if (mode === 'color') {
      // Color palette with error diffusion
      return image.dither(true)
    }

    // Fallback: return image unchanged
    return image
  }
}
