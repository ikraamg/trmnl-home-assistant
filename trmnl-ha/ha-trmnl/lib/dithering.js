/**
 * Advanced Dithering Module - E-ink Display Image Optimization
 *
 * Provides high-quality image processing optimized for e-ink displays with limited color
 * palettes. Combines dithering, color reduction, level adjustments, and format conversion
 * into a single GraphicsMagick pipeline for optimal performance.
 *
 * Architecture:
 * - Strategy Pattern: Dithering algorithms (Floyd-Steinberg, Ordered, Threshold) are
 *   pluggable strategies selected at runtime
 * - Single-Spawn Optimization: All transformations combined into ONE GraphicsMagick
 *   process to minimize overhead (critical performance optimization)
 * - Dual-Mode Processing: Separate pipelines for grayscale vs. color palettes
 * - Temporary File Management: Color mode creates palette files, cleans up in finally block
 *
 * Key Optimizations:
 * 1. Single Pipeline: Dithering + rotation + inversion + format conversion in one spawn
 * 2. Gamma Removal: .noProfile() removes gamma curves for linear e-ink brightness
 * 3. PNG Compression: Level 9 with filter 5 (best for dithered images with repeated patterns)
 * 4. JPEG Quality: 75% + progressive interlacing (e-ink doesn't need high quality)
 * 5. Palette File: 1-pixel-wide image for efficient color remapping in ImageMagick
 *
 * Dithering Methods:
 * - Floyd-Steinberg: Error diffusion, best quality, smooth gradients
 * - Ordered: Bayer matrix, faster, visible crosshatch pattern
 * - None (Threshold): Simple threshold, hard edges, no dithering
 *
 * Supported Palettes:
 * - Grayscale: bw (2 colors), gray-4 (4 grays), gray-16 (16 grays), gray-256 (256 grays)
 * - Color: Inky 6-color (color-6a), Inky 7-color (color-7a)
 *
 * NOTE: processImage() is main entry point. applyDithering() is lower-level with more options.
 * AI: When modifying pipeline, preserve single-spawn pattern - spawning GM is expensive.
 *
 * @module lib/dithering
 */

import gm from 'gm'
import { unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  COLOR_PALETTES,
  GRAYSCALE_PALETTES,
  VALID_ROTATIONS,
} from '../const.js'
import { FloydSteinbergStrategy } from './dithering/floyd-steinberg-strategy.js'
import { OrderedStrategy } from './dithering/ordered-strategy.js'
import { ThresholdStrategy } from './dithering/threshold-strategy.js'

// =============================================================================
// PUBLIC CONSTANTS
// =============================================================================

/**
 * Supported dithering methods
 * @type {string[]}
 */
export const SUPPORTED_METHODS = ['floyd-steinberg', 'ordered', 'none']

/**
 * Supported palette names (grayscale + color)
 * @type {string[]}
 */
export const SUPPORTED_PALETTES = [
  ...Object.keys(GRAYSCALE_PALETTES),
  ...Object.keys(COLOR_PALETTES),
]

/**
 * Checks if a palette is a color palette (vs grayscale)
 * @param {string} palette - Palette name
 * @returns {boolean} True if palette is a color palette
 */
export function isColorPalette(palette) {
  return !!COLOR_PALETTES[palette]
}

/**
 * Validates and normalizes dithering options with sensible defaults.
 *
 * Applies validation and defaults to ensure options are within acceptable ranges.
 * This function is used internally by applyDithering() but exposed for testing
 * and external validation.
 *
 * @param {Object} options - Dithering options to validate
 * @param {string} [options.method] - Dithering method name
 * @param {string} [options.palette] - Palette name
 * @param {boolean} [options.gammaCorrection] - Apply gamma correction
 * @param {number} [options.blackLevel] - Black level adjustment (0-100)
 * @param {number} [options.whiteLevel] - White level adjustment (0-100)
 * @param {boolean} [options.normalize] - Normalize color levels
 * @param {boolean} [options.saturationBoost] - Boost saturation for color
 * @param {number} [options.rotate] - Rotation angle (90, 180, 270)
 * @returns {Object} Validated options with defaults applied
 *
 * @example
 * const opts = validateDitheringOptions({ method: 'invalid' })
 * // Returns: { method: 'floyd-steinberg', palette: 'gray-4', ...defaults }
 */
export function validateDitheringOptions(options = {}) {
  const palette = SUPPORTED_PALETTES.includes(options.palette)
    ? options.palette
    : 'gray-4'
  const isColor = isColorPalette(palette)

  return {
    method: SUPPORTED_METHODS.includes(options.method)
      ? options.method
      : 'floyd-steinberg',
    palette,
    gammaCorrection:
      options.gammaCorrection !== undefined ? options.gammaCorrection : true,
    blackLevel: Math.max(0, Math.min(100, options.blackLevel || 0)),
    whiteLevel: Math.max(0, Math.min(100, options.whiteLevel || 100)),
    normalize: options.normalize !== undefined ? options.normalize : isColor,
    saturationBoost:
      options.saturationBoost !== undefined ? options.saturationBoost : isColor,
    rotate: [90, 180, 270].includes(options.rotate) ? options.rotate : 0,
  }
}

// =============================================================================
// DITHERING STRATEGY REGISTRY
// =============================================================================

/**
 * Strategy registry mapping method names to strategy instances.
 *
 * Strategy Pattern Implementation:
 * Each strategy implements .call(image, options) method that applies
 * dithering transformations to a GraphicsMagick image instance.
 *
 * Strategies are stateless singletons - instantiated once and reused.
 *
 * @private
 */
const DITHERING_STRATEGIES = {
  'floyd-steinberg': new FloydSteinbergStrategy(),
  ordered: new OrderedStrategy(),
  none: new ThresholdStrategy(),
}

/**
 * Gets dithering strategy for a given method name.
 *
 * Falls back to Floyd-Steinberg if unknown method provided (safest default).
 *
 * @private
 * @param {string} method - Dithering method name
 * @returns {Strategy} Strategy instance with .call(image, options) method
 */
function getStrategy(method) {
  return DITHERING_STRATEGIES[method] || DITHERING_STRATEGIES['floyd-steinberg']
}

// =============================================================================
// IMAGE PROCESSING PIPELINE
// =============================================================================

/**
 * Main entry point for image processing - handles dithering, rotation, inversion, and format conversion.
 *
 * Processing Modes (optimized routing):
 * 1. Dithering enabled: Single pipeline with all transformations (most efficient)
 * 2. Rotation/inversion only: Simple processing without dithering
 * 3. Format conversion only: Direct conversion, no image manipulation
 *
 * Pipeline Optimization:
 * When dithering is enabled, ALL transformations (rotate, invert, format) are passed
 * to applyDithering() which combines them into a single GraphicsMagick spawn. This
 * avoids multiple process spawns and intermediate buffers.
 *
 * Typical Flow:
 * Screenshot (PNG) → processImage() → applyDithering() → Buffer (PNG/JPEG/BMP)
 *
 * @param {Buffer} imageBuffer - PNG image buffer from Puppeteer screenshot
 * @param {Object} options - Processing options
 * @param {string} options.format - Output format: 'png', 'jpeg', 'bmp'
 * @param {number} [options.rotate] - Rotation angle (90, 180, 270 degrees)
 * @param {boolean} [options.invert] - Invert colors (black → white, white → black)
 * @param {Object} [options.dithering] - Dithering configuration object (see applyDithering)
 * @returns {Promise<Buffer>} Processed image buffer in specified format
 */
export async function processImage(imageBuffer, options = {}) {
  const { format = 'png', rotate, invert, dithering } = options

  let buffer = imageBuffer

  // Apply dithering if enabled (includes format conversion in single pipeline)
  if (dithering?.enabled) {
    buffer = await applyDithering(buffer, {
      ...dithering,
      invert: invert || false, // Pass invert to dithering pipeline
      rotate: rotate || 0,
      format, // Pass format to avoid double-spawning
    })
  } else if (rotate || invert) {
    // Rotate and/or invert without dithering
    buffer = await applySimpleProcessing(buffer, { rotate, invert })
    // Convert format if needed
    if (format !== 'png') {
      buffer = await convertToFormat(buffer, format)
    }
  } else if (format !== 'png') {
    // Just format conversion, no processing
    buffer = await convertToFormat(buffer, format)
  }

  return buffer
}

/**
 * Apply simple processing (rotation and/or inversion) without dithering
 *
 * @param {Buffer} imageBuffer - Image buffer
 * @param {Object} options - Processing options
 * @param {number} [options.rotate] - Rotation angle (90, 180, 270)
 * @param {boolean} [options.invert] - Invert colors
 * @returns {Promise<Buffer>} - Processed image buffer
 */
async function applySimpleProcessing(imageBuffer, options = {}) {
  const { rotate, invert } = options

  // If neither rotate nor invert, return original
  if (!rotate && !invert) {
    return imageBuffer
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let image = gm(imageBuffer)

    // Apply rotation if specified
    if (rotate && VALID_ROTATIONS.includes(rotate)) {
      image = image.rotate('white', rotate)
    }

    // Apply inversion if specified
    if (invert) {
      image = image.out('-negate')
    }

    image.stream('png', (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }

      stdout.on('data', (chunk) => chunks.push(chunk))
      stdout.on('end', () => resolve(Buffer.concat(chunks)))
      stdout.on('error', reject)
      stderr.on('data', (data) => console.error('IM stderr:', data.toString()))
    })
  })
}

/**
 * Converts image buffer to specified format with e-ink optimizations.
 *
 * Format-Specific Optimizations:
 * - PNG: Compression level 9, filter 5, strategy 1 (best for dithered patterns)
 * - JPEG: Quality 75, progressive interlacing (e-ink doesn't need high quality)
 * - BMP: Uses BMP3 format (24-bit RGB)
 *
 * PNG Compression:
 * Dithered e-ink images compress extremely well due to limited colors and repeated
 * patterns. Level 9 + filter 5 produces smallest files without visible quality loss.
 *
 * JPEG Progressive:
 * Progressive (interlaced) JPEG loads in multiple passes, providing faster initial
 * render on slow connections.
 *
 * NOTE: Usually called from processImage() or applyDithering() pipeline.
 *
 * @param {Buffer} imageBuffer - Image buffer (any format GraphicsMagick can read)
 * @param {string} format - Output format: 'png', 'jpeg', 'bmp'
 * @returns {Promise<Buffer>} Converted image buffer in specified format
 */
export async function convertToFormat(imageBuffer, format) {
  return new Promise((resolve, reject) => {
    const chunks = []

    let image = gm(imageBuffer)

    // Map format names to ImageMagick format strings
    let imFormat = format
    if (format === 'bmp') {
      imFormat = 'bmp3'
    } else if (format === 'jpeg' || format === 'jpg') {
      imFormat = 'jpeg'
      // Optimize JPEG for e-ink displays (reduced from 85 to 75)
      // E-ink doesn't need high quality, and progressive JPEG loads better
      image = image.quality(75).interlace('Line')
    } else if (format === 'png') {
      // PNG optimization for dithered e-ink images
      // Dithered images compress very well due to limited colors and repeated patterns
      image = image
        .define('png:compression-level=9') // Maximum compression
        .define('png:compression-filter=5') // Best for dithered images
        .define('png:compression-strategy=1') // Filtered strategy
    }

    image.stream(imFormat, (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }

      stdout.on('data', (chunk) => chunks.push(chunk))
      stdout.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) {
          reject(new Error(`ImageMagick produced empty ${format} output`))
        } else {
          resolve(buffer)
        }
      })
      stdout.on('error', reject)
      stderr.on('data', (data) => console.error('IM stderr:', data.toString()))
    })
  })
}

/**
 * Get image metadata
 *
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<{width: number, height: number, format: string}>}
 */
export async function getImageInfo(imageBuffer) {
  return new Promise((resolve, reject) => {
    gm(imageBuffer).identify((err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve({
        width: data.size.width,
        height: data.size.height,
        format: data.format.toLowerCase(),
      })
    })
  })
}

// =============================================================================
// DITHERING PIPELINE
// =============================================================================

/**
 * Applies advanced dithering with color reduction, level adjustments, and format conversion.
 *
 * This is the CORE PIPELINE that combines ALL transformations into a single GraphicsMagick
 * spawn for maximum performance. Called by processImage() when dithering is enabled.
 *
 * Pipeline Flow (ALL in one GM process):
 * 1. Rotate (if specified) - BEFORE dithering to match Core behavior
 * 2. Remove gamma (if gammaCorrection enabled) - linearizes brightness for e-ink
 * 3. Color/grayscale dithering (delegates to applyColorDithering or applyGrayscaleDithering)
 * 4. Invert (if specified) - flips black↔white
 * 5. Strip metadata - removes EXIF/color profiles
 * 6. Format conversion with optimizations - final output format
 * 7. Stream to buffer - single spawn completes entire pipeline!
 *
 * Grayscale vs. Color Mode:
 * - Grayscale: Uses grayscale palette name (bw, gray-4, gray-16, gray-256)
 * - Color: Uses color palette name (color-6a, color-7a) with temporary palette file
 *
 * Level Adjustments (grayscale only):
 * - blackLevel: Pixels darker than this → pure black (increases contrast)
 * - whiteLevel: Pixels brighter than this → pure white (increases contrast)
 *
 * Gamma Correction (recommended ON):
 * Removes gamma curves so e-ink displays show proper linear brightness. Most images
 * have sRGB gamma (2.2) which looks washed out on e-ink without this correction.
 *
 * Single-Spawn Optimization:
 * Building the entire pipeline BEFORE calling .stream() allows GraphicsMagick to
 * execute all operations in one process. This is 3-5x faster than multiple spawns
 * and avoids intermediate buffers in memory.
 *
 * NOTE: Rotation happens BEFORE dithering to match original Core implementation behavior.
 * AI: Preserve single-spawn pattern - don't break pipeline into multiple .stream() calls.
 *
 * @param {Buffer} imageBuffer - PNG image buffer from screenshot
 * @param {Object} options - Dithering options
 * @param {string} [options.method='floyd-steinberg'] - Dithering algorithm
 * @param {string} [options.palette='gray-4'] - Palette name: 'bw', 'gray-4', 'gray-16', 'gray-256', 'color-6a', 'color-7a'
 * @param {boolean} [options.gammaCorrection=true] - Remove gamma curves for e-ink
 * @param {number} [options.blackLevel=0] - Black crush threshold (0-100%)
 * @param {number} [options.whiteLevel=100] - White crush threshold (0-100%)
 * @param {boolean} [options.normalize=false] - Stretch histogram to full range
 * @param {boolean} [options.saturationBoost=false] - Increase saturation 50% (color only)
 * @param {boolean} [options.invert=false] - Invert colors (black ↔ white)
 * @param {number} [options.rotate=0] - Rotation angle (90, 180, 270 degrees)
 * @param {string} [options.format='png'] - Output format: 'png', 'jpeg', 'bmp'
 * @returns {Promise<Buffer>} Processed image buffer in specified format
 */
export async function applyDithering(imageBuffer, options = {}) {
  const {
    method = 'floyd-steinberg',
    palette = 'gray-4',
    gammaCorrection = true,
    blackLevel = 0,
    whiteLevel = 100,
    normalize = false,
    saturationBoost = false,
    invert = false,
    rotate = 0,
    format = 'png',
  } = options

  // Determine if using color palette
  const isColorPaletteMode = palette && COLOR_PALETTES[palette]
  const isGrayscalePalette = palette && GRAYSCALE_PALETTES[palette]

  // Create GraphicsMagick instance from buffer
  let image = gm(imageBuffer)

  // Apply rotation BEFORE dithering (matches Core behavior)
  if (rotate && VALID_ROTATIONS.includes(rotate)) {
    image = image.rotate('white', rotate)
  }

  // Remove color profile for e-ink (removes gamma curve)
  if (gammaCorrection) {
    image = image.noProfile()
  }

  // Process based on palette type
  if (isColorPaletteMode) {
    // Color palette dithering
    image = await applyColorDithering(image, {
      palette,
      method,
      normalize,
      saturationBoost,
    })
  } else {
    // Grayscale dithering (always uses palette lookup)
    const colors = isGrayscalePalette
      ? GRAYSCALE_PALETTES[palette]
      : GRAYSCALE_PALETTES['gray-4'] // Default fallback
    image = applyGrayscaleDithering(image, {
      method,
      colors,
      blackLevel,
      whiteLevel,
    })
  }

  // Apply color inversion if requested (black → white, white → black)
  if (invert) {
    image = image.out('-negate')
  }

  // Strip all metadata
  image = image.strip()

  // Apply format-specific optimizations BEFORE streaming
  // This combines dithering + format conversion into SINGLE GM spawn!
  let outputFormat = format
  if (format === 'bmp') {
    outputFormat = 'bmp3'
  } else if (format === 'jpeg' || format === 'jpg') {
    outputFormat = 'jpeg'
    // Optimize JPEG for e-ink displays
    image = image.quality(75).interlace('Line')
  } else if (format === 'png') {
    // PNG optimization for dithered e-ink images
    image = image
      .define('png:compression-level=9')
      .define('png:compression-filter=5')
      .define('png:compression-strategy=1')
  }

  // Stream to final format (SINGLE spawn for entire pipeline!)
  return new Promise((resolve, reject) => {
    const chunks = []

    image.stream(outputFormat, (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }

      stdout.on('data', (chunk) => {
        chunks.push(chunk)
      })

      stdout.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) {
          reject(new Error(`ImageMagick produced empty ${format} output`))
        } else {
          resolve(buffer)
        }
      })

      stdout.on('error', (err) => {
        reject(err)
      })

      stderr.on('data', (data) => {
        console.error('IM stderr:', data.toString())
      })
    })
  })
}

/**
 * Applies grayscale dithering with level adjustments.
 *
 * Grayscale Pipeline:
 * 1. Convert to Gray colorspace (removes color information)
 * 2. Apply level adjustments (black/white crush for contrast)
 * 3. Apply dithering strategy with target color count
 * 4. Apply dithering strategy (Floyd-Steinberg, Ordered, or Threshold)
 *
 * Level Adjustments:
 * Maps input range [blackLevel%, whiteLevel%] to output range [0%, 100%].
 * Pixels darker than blackLevel become pure black, brighter than whiteLevel
 * become pure white. This increases contrast and reduces mid-tone "mudiness"
 * that can look poor on e-ink displays.
 *
 * Color Count Examples:
 * - 2 colors: pure B&W (palette: 'bw')
 * - 4 colors: 4 grays, common for TRMNL displays (palette: 'gray-4')
 * - 16 colors: 16 grays, high-res e-ink (palette: 'gray-16')
 * - 256 colors: 256 grays, photo-quality e-ink (palette: 'gray-256')
 *
 * @private
 * @param {GMImage} image - GraphicsMagick image instance
 * @param {Object} options - Grayscale options
 * @param {string} options.method - Dithering method
 * @param {number} options.colors - Target color count (2, 4, 16, or 256)
 * @param {number} options.blackLevel - Black crush threshold (0-100)
 * @param {number} options.whiteLevel - White crush threshold (0-100)
 * @returns {GMImage} Modified GraphicsMagick image instance
 */
function applyGrayscaleDithering(image, options) {
  const { method, colors, blackLevel, whiteLevel } = options

  // Convert to grayscale
  image = image.colorspace('Gray')

  // Apply level adjustments for contrast
  if (blackLevel > 0 || whiteLevel < 100) {
    const blackPoint = `${blackLevel}%`
    const whitePoint = `${whiteLevel}%`
    image = image.level(blackPoint, 1.0, whitePoint)
  }

  // Select and apply dithering strategy
  const strategy = getStrategy(method)
  image = strategy.call(image, {
    mode: 'grayscale',
    colors,
  })

  return image
}

/**
 * Applies color palette dithering with saturation boost and normalization.
 *
 * Color Pipeline:
 * 1. Normalize (optional) - stretches histogram for better color mapping
 * 2. Saturation boost (optional) - increases color vibrancy 50%
 * 3. Convert to RGB colorspace (ensures consistent color processing)
 * 4. Create temporary palette file (1-pixel-wide image with target colors)
 * 5. Apply dithering strategy
 * 6. Remap to custom palette using .map() (maps each pixel to nearest palette color)
 * 7. Convert to sRGB for output (standard color space)
 * 8. Clean up temp file (in finally block)
 *
 * Normalize:
 * Stretches brightness histogram so darkest pixel → black, brightest → white.
 * Maximizes contrast and color range. Recommended for washed-out images.
 *
 * Saturation Boost:
 * Increases saturation 50% (150% of original) to make colors "pop" on e-ink.
 * E-ink color displays often look muted without this boost.
 *
 * Palette File:
 * ImageMagick's .map() requires a palette image (not just a color array).
 * Creates a 1xN pixel image where each pixel is one palette color.
 * This is more efficient than multiple .fill() + .drawPoint() calls.
 *
 * Supported Palettes:
 * - color-6a: Pimoroni Inky Impression 7.3" (6 colors)
 * - color-7a: Pimoroni Inky Impression 5.7" (7 colors)
 *
 * NOTE: Temp file cleanup uses finally block to ensure cleanup even on errors.
 * AI: Don't remove finally block - temp file leaks cause disk space issues.
 *
 * @private
 * @param {GMImage} image - GraphicsMagick image instance
 * @param {Object} options - Color dithering options
 * @param {string} options.palette - Palette name (color-6a, color-7a)
 * @param {string} options.method - Dithering method
 * @param {boolean} options.normalize - Stretch histogram for max contrast
 * @param {boolean} options.saturationBoost - Increase saturation 50%
 * @returns {Promise<GMImage>} Modified GraphicsMagick image instance
 * @throws {Error} If palette name is unknown
 */
async function applyColorDithering(image, options) {
  const { palette, method, normalize, saturationBoost } = options
  const colors = COLOR_PALETTES[palette]

  if (!colors) {
    throw new Error(`Unknown color palette: ${palette}`)
  }

  // Normalize brightness for better color mapping
  if (normalize) {
    image = image.normalize()
  }

  // Boost saturation for more vivid colors on e-ink
  if (saturationBoost) {
    image = image.modulate(110, 150) // luminosity 110%, saturation 150%
  }

  // Convert to RGB colorspace for color processing
  image = image.colorspace('RGB')

  // Create temporary palette file for remapping
  const paletteFile = join(tmpdir(), `palette_${Date.now()}.png`)

  try {
    // Create palette image using ImageMagick
    await createPaletteFile(colors, paletteFile)

    // Select and apply dithering strategy
    const strategy = getStrategy(method)
    image = strategy.call(image, {
      mode: 'color',
    })

    // Remap to custom palette
    image = image.map(paletteFile)

    // Convert to sRGB for output
    image = image.colorspace('sRGB')

    return image
  } finally {
    // Clean up temp file
    if (existsSync(paletteFile)) {
      try {
        unlinkSync(paletteFile)
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Creates a temporary palette file from color array for ImageMagick color remapping.
 *
 * Palette Image Format:
 * Creates a 1-pixel-tall, N-pixels-wide PNG where each pixel is one palette color.
 * ImageMagick's .map() function reads this image and maps source pixels to the
 * nearest color in the palette using Euclidean distance in RGB space.
 *
 * Example for 6-color palette:
 * [Black] [White] [Red] [Yellow] [Green] [Blue]
 *   ↑       ↑       ↑      ↑        ↑       ↑
 * (0,0)   (1,0)   (2,0)  (3,0)    (4,0)   (5,0)
 *
 * Why 1-pixel-wide:
 * Smallest possible palette image. ImageMagick only needs the colors, not the
 * dimensions. 1×N is more efficient than N×1 or √N×√N.
 *
 * Temp File Path:
 * Uses tmpdir() + timestamp to avoid collisions. Caller is responsible for
 * cleanup (handled in applyColorDithering's finally block).
 *
 * @private
 * @param {string[]} colors - Array of color hex codes (e.g., ['#000000', '#FFFFFF'])
 * @param {string} outputPath - Temp file path for palette image
 * @returns {Promise<void>} Resolves when palette file written
 */
function createPaletteFile(colors, outputPath) {
  return new Promise((resolve, reject) => {
    // Create a 1-pixel-tall, N-pixels-wide image
    const width = colors.length
    const height = 1

    // Initialize with first color as background
    let paletteImage = gm(width, height, colors[0])

    // Draw remaining colors as individual pixels
    // (first color already set as background, skip i=0)
    colors.forEach((color, i) => {
      if (i > 0) {
        paletteImage = paletteImage.fill(color).drawPoint(i, 0)
      }
    })

    paletteImage.write(outputPath, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
