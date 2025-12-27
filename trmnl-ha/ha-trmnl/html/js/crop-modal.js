/* global document, interact */
/**
 * Crop Modal Module
 *
 * Interactive modal for visual crop/zoom region selection.
 * Integrates Interact.js for drag-and-resize functionality.
 *
 * Design Pattern:
 * Coordinate System Adapter Pattern - converts between three coordinate spaces:
 * 1. Viewport coordinates (actual screenshot pixels, e.g., 800×480)
 * 2. Display coordinates (scaled CSS pixels in modal, e.g., 400×240)
 * 3. Interact.js transform coordinates (cumulative deltas from drag/resize)
 *
 * Coordinate Conversion Complexity:
 * Most complex aspect of this module is managing three coordinate systems.
 * Screenshot may be displayed at different scale (CSS max-width constraint).
 * Crop overlay must track position in both display and viewport coordinates.
 *
 * Why Three Coordinate Systems?:
 * - Viewport: What backend needs (actual screenshot pixels)
 * - Display: What user sees (may be scaled down for UI)
 * - Transform: How Interact.js tracks movement (delta-based)
 *
 * Scaling Factor (containerScale):
 * Ratio between display and viewport coordinates.
 * Example: 800px viewport displayed at 400px → scale = 0.5
 * Used to convert overlay position back to viewport coordinates.
 *
 * Interact.js Integration:
 * Third-party library providing drag-and-resize on DOM elements.
 * Uses data-x/data-y attributes to track cumulative transform.
 * Modifiers array enables aspect ratio locking.
 *
 * Aspect Ratio Locking:
 * Crop overlay maintains viewport aspect ratio (width/height).
 * Ensures cropped region matches target device dimensions.
 * Example: 800×480 viewport → 5:3 aspect ratio always maintained.
 *
 * State Management:
 * #modalState holds crop coordinates and scale factor.
 * Updated on every drag/resize event via #updateCropFromTransform().
 * Rounds to integers when applied (pixel-perfect cropping).
 *
 * Callback Pattern:
 * Constructor doesn't take onApply - stored when open() called.
 * Allows single modal instance to be reused for different schedules.
 * Callback invoked with crop settings when user clicks Apply.
 *
 * Image Loading Flow:
 * 1. Show modal with loading state
 * 2. Fetch screenshot via API (same params as preview generator)
 * 3. Load image in Promise (await onload event)
 * 4. Calculate container scale factor
 * 5. Position crop overlay at initial coordinates
 * 6. Initialize Interact.js drag/resize handlers
 *
 * Blob URL Management:
 * Creates blob URL for image display (URL.createObjectURL).
 * Revokes on close (prevents memory leak).
 * Better than preview-generator (which never revoked).
 *
 * Initial Crop Position:
 * If schedule has existing crop → use those coordinates
 * If no crop → default to full viewport (0, 0, width, height)
 * Allows editing existing crops or creating new ones.
 *
 * Boundary Clamping:
 * Crop coordinates clamped to viewport bounds (can't go negative or exceed viewport).
 * Minimum crop size enforced (50×50px minimum).
 * Prevents invalid crop configurations.
 *
 * Transform Data Attributes:
 * Interact.js uses data-x and data-y to track cumulative movement.
 * Checked via hasAttribute('data-x') to distinguish first-time setup.
 * Reset on modal reset (back to 0,0 transform).
 *
 * Error Handling:
 * Screenshot fetch errors show alert modal (ConfirmModal).
 * Modal automatically closed on error (prevents stuck state).
 * Errors logged to console for debugging.
 *
 * NOTE: Requires Interact.js library loaded globally (via CDN or bundle).
 * AI: When modifying coordinate conversions, test with various display scales.
 *
 * @module html/js/crop-modal
 */

import { FetchPreview } from './api-client.js'
import { ConfirmModal } from './confirm-modal.js'

/**
 * Interactive crop modal with Interact.js integration.
 *
 * Responsibilities:
 * - Fetch uncropped screenshot for preview
 * - Display interactive crop overlay
 * - Convert between viewport/display/transform coordinates
 * - Enforce aspect ratio and boundary constraints
 * - Apply crop settings via callback
 *
 * Coordinate System Management:
 * Three coordinate spaces require constant conversion:
 * - Viewport (backend): Actual screenshot pixels
 * - Display (frontend): Scaled CSS pixels in modal
 * - Transform (Interact.js): Cumulative drag/resize deltas
 *
 * State Persistence:
 * #modalState.crop holds authoritative crop coordinates (viewport space).
 * containerScale tracks display-to-viewport ratio for conversions.
 *
 * @class
 */
export class CropModal {
  // Command instances (dependency injection)
  #fetchPreviewCmd
  #confirmModal

  // Modal state (crop coordinates + scaling factor)
  #modalState = {
    crop: { x: 0, y: 0, width: 800, height: 480 }, // Viewport coordinates
    containerScale: 1, // Display ÷ Viewport scaling factor
  }

  // Callback invoked when crop applied
  #onApply = null

  /**
   * Creates modal and initializes commands.
   * Callback stored later when open() called (allows reuse for different schedules).
   */
  constructor() {
    this.#fetchPreviewCmd = new FetchPreview()
    this.#confirmModal = new ConfirmModal()
  }

  /**
   * Opens interactive crop modal for schedule.
   *
   * Initialization Flow:
   * 1. Validate schedule exists (show warning if null)
   * 2. Store onApply callback for later
   * 3. Initialize crop from schedule or default to full viewport
   * 4. Show modal with loading state
   * 5. Fetch screenshot (same params as preview generator)
   * 6. Load image and initialize Interact.js overlay
   * 7. OR show error and close modal on failure
   *
   * Initial Crop Coordinates:
   * If schedule.crop.enabled → use existing crop coordinates
   * Otherwise → default to full viewport (0, 0, width, height)
   *
   * Async Operation:
   * Awaits screenshot fetch and image load.
   * Caller should await if they need to know when modal ready.
   *
   * Error Recovery:
   * Shows alert modal on screenshot fetch failure.
   * Automatically closes crop modal (prevents stuck state).
   *
   * @param {Object} schedule - Schedule configuration with viewport/dashboard
   * @param {Function} onApply - Callback when crop applied: (cropSettings) => void
   * @returns {Promise<void>} Resolves when modal displayed or error handled
   */
  async open(schedule, onApply) {
    if (!schedule) {
      await this.#confirmModal.alert({
        title: 'No Schedule Selected',
        message: 'Please select a schedule first.',
        type: 'warning',
      })
      return
    }

    this.#onApply = onApply

    // Initialize crop from schedule or default to full viewport
    this.#modalState.crop = schedule.crop?.enabled
      ? { ...schedule.crop }
      : {
          x: 0,
          y: 0,
          width: schedule.viewport.width,
          height: schedule.viewport.height,
        }

    // Show modal with loading state
    this.#showModal(true)

    try {
      // Build URL and fetch screenshot
      const params = this.#buildUrlParams(schedule)
      const blob = await this.#fetchPreviewCmd.call(
        schedule.dashboard_path,
        params
      )
      const imageUrl = URL.createObjectURL(blob)

      // Load and display image
      await this.#loadImage(imageUrl, schedule)
    } catch (err) {
      console.error('Error loading screenshot:', err)
      await this.#confirmModal.alert({
        title: 'Error Loading Screenshot',
        message: `Failed to load screenshot: ${err.message}`,
        type: 'error',
      })
      this.close()
    }
  }

  /**
   * Closes crop modal and cleans up resources.
   *
   * Cleanup:
   * - Hides modal DOM element
   * - Revokes blob URL (prevents memory leak)
   * - Clears image src (releases blob reference)
   *
   * Memory Management:
   * Properly revokes blob URL created in open().
   * Better than preview-generator which leaves blob URLs active.
   */
  close() {
    const modal = document.getElementById('cropModal')
    modal?.classList.add('hidden')

    // Clean up blob URL (prevent memory leak)
    const img = document.getElementById('modalPreviewImage')
    if (img?.src) {
      URL.revokeObjectURL(img.src)
      img.src = ''
    }
  }

  /**
   * Resets crop to full viewport (no cropping).
   *
   * Reset Flow:
   * 1. Update #modalState.crop to full viewport dimensions
   * 2. Clear Interact.js transform attributes (data-x, data-y)
   * 3. Reset CSS transform to identity
   * 4. Re-position overlay via #updateCropOverlay()
   *
   * Interact.js Cleanup:
   * Removes data-x/data-y attributes and resets transform style.
   * Forces #updateCropOverlay() to treat as first-time setup.
   *
   * @param {Object} schedule - Schedule with viewport dimensions
   */
  reset(schedule) {
    if (!schedule) return

    const overlay = document.getElementById('cropOverlay')

    // Reset crop state
    this.#modalState.crop = {
      x: 0,
      y: 0,
      width: schedule.viewport.width,
      height: schedule.viewport.height,
    }

    // Reset Interact.js transform
    if (overlay) {
      overlay.removeAttribute('data-x')
      overlay.removeAttribute('data-y')
      overlay.style.transform = 'translate(0px, 0px)'
    }

    // Re-apply overlay position
    this.#updateCropOverlay(schedule)
  }

  /**
   * Applies current crop settings via callback.
   *
   * Crop Settings Object:
   * {
   *   enabled: true,
   *   x: rounded X offset in viewport pixels
   *   y: rounded Y offset in viewport pixels
   *   width: rounded width in viewport pixels
   *   height: rounded height in viewport pixels
   * }
   *
   * Rounding:
   * All coordinates rounded to nearest integer (pixel-perfect).
   * Viewport coordinates (not display coordinates).
   *
   * Callback Pattern:
   * Invokes onApply callback stored during open().
   * Caller receives crop settings and updates schedule.
   *
   * Auto-Close:
   * Modal closed after applying (one-shot operation).
   */
  apply() {
    if (!this.#onApply) return

    const cropSettings = {
      enabled: true,
      x: Math.round(this.#modalState.crop.x),
      y: Math.round(this.#modalState.crop.y),
      width: Math.round(this.#modalState.crop.width),
      height: Math.round(this.#modalState.crop.height),
    }

    this.#onApply(cropSettings)
    this.close()
  }

  /**
   * Shows/hides the modal
   */
  #showModal(loading = false) {
    const modal = document.getElementById('cropModal')
    const loadingEl = document.getElementById('modalLoading')
    const img = document.getElementById('modalPreviewImage')
    const overlay = document.getElementById('cropOverlay')

    modal?.classList.remove('hidden')

    if (loading) {
      loadingEl?.classList.remove('hidden')
      img?.classList.add('hidden')
      overlay?.classList.add('hidden')
    }
  }

  /**
   * Builds URL parameters for screenshot fetch
   */
  #buildUrlParams(schedule) {
    const params = new URLSearchParams()
    params.append(
      'viewport',
      `${schedule.viewport.width}x${schedule.viewport.height}`
    )

    if (schedule.format && schedule.format !== 'png') {
      params.append('format', schedule.format)
    }
    if (schedule.rotate) {
      params.append('rotate', schedule.rotate)
    }
    if (schedule.zoom && schedule.zoom !== 1) {
      params.append('zoom', schedule.zoom)
    }
    if (schedule.wait) {
      params.append('wait', schedule.wait)
    }
    if (schedule.theme) {
      params.append('theme', schedule.theme)
    }
    if (schedule.lang) {
      params.append('lang', schedule.lang)
    }
    if (schedule.dark) {
      params.append('dark', '')
    }
    if (schedule.invert) {
      params.append('invert', '')
    }

    // Dithering settings
    if (schedule.dithering?.enabled) {
      params.append('dithering', '')
      if (schedule.dithering.method) {
        params.append('dither_method', schedule.dithering.method)
      }
      params.append('palette', schedule.dithering.palette || 'gray-4')
      if (
        schedule.dithering.gammaCorrection !== undefined &&
        !schedule.dithering.gammaCorrection
      ) {
        params.append('no_gamma', '')
      }
      if (schedule.dithering.blackLevel !== undefined) {
        params.append('black_level', schedule.dithering.blackLevel)
      }
      if (schedule.dithering.whiteLevel !== undefined) {
        params.append('white_level', schedule.dithering.whiteLevel)
      }
      if (schedule.dithering.normalize) {
        params.append('normalize', '')
      }
      if (schedule.dithering.saturationBoost) {
        params.append('saturation_boost', '')
      }
    }

    return params
  }

  /**
   * Loads the image and initializes crop overlay
   */
  async #loadImage(imageUrl, schedule) {
    return new Promise((resolve, reject) => {
      const img = document.getElementById('modalPreviewImage')
      const loadingEl = document.getElementById('modalLoading')

      img.onload = () => {
        // Hide loading, show image
        loadingEl?.classList.add('hidden')
        img.classList.remove('hidden')

        // Position container for the image
        const container = document.getElementById('modalPreviewContainer')
        if (container) {
          container.style.position = 'relative'
          container.style.display = 'block'
        }

        // Initialize crop overlay and Interact.js
        this.#updateCropOverlay(schedule)
        document.getElementById('cropOverlay')?.classList.remove('hidden')
        this.#initInteract(schedule)

        resolve()
      }

      img.onerror = () => {
        reject(new Error('Failed to load image'))
      }

      img.src = imageUrl
    })
  }

  /**
   * Positions crop overlay from viewport coordinates (viewport → display conversion).
   *
   * Critical Coordinate Conversion:
   * This method converts FROM viewport coordinates TO display coordinates.
   * Inverse of #updateCropFromTransform (which converts display → viewport).
   *
   * Conversion Algorithm:
   * 1. Calculate containerScale (displayedWidth ÷ actualWidth)
   * 2. Get image offset within container (for absolute positioning)
   * 3. Convert crop coordinates: display = viewport * containerScale + imageOffset
   * 4. Set overlay CSS (left, top, width, height)
   * 5. Initialize Interact.js transform (data-x=0, data-y=0)
   *
   * Container Scale:
   * Ratio between displayed image size and actual viewport size.
   * Example: 800px viewport displayed at 400px → scale = 0.5
   * Stored in #modalState.containerScale for use by other methods.
   *
   * Image Offset:
   * Image may not align with container (e.g., centered with margins).
   * Uses getBoundingClientRect() to find absolute positions.
   * Offset = imgRect.left - containerRect.left
   *
   * First-Time Setup Check:
   * Checks overlay.hasAttribute('data-x') to detect first-time setup.
   * If not first-time, preserves Interact.js transform (don't reset).
   * Prevents clobbering user's drag position during resize events.
   *
   * Dimensions Display:
   * Calls #updateDimensionsDisplay() to show crop metrics.
   *
   * @param {Object} schedule - Schedule with viewport dimensions
   */
  #updateCropOverlay(schedule) {
    if (!schedule) return

    const overlay = document.getElementById('cropOverlay')
    const img = document.getElementById('modalPreviewImage')
    if (!overlay || !img) return

    // Image's actual size (from viewport)
    const actualWidth = schedule.viewport.width
    const _actualHeight = schedule.viewport.height

    // Image's displayed size (may be scaled down by CSS)
    const displayedWidth = img.clientWidth
    const _displayedHeight = img.clientHeight

    // Calculate scaling factor
    this.#modalState.containerScale = displayedWidth / actualWidth

    // Get image position relative to container
    const imgRect = img.getBoundingClientRect()
    const containerRect = document
      .getElementById('modalPreviewContainer')
      ?.getBoundingClientRect()
    if (!containerRect) return

    const imgOffsetX = imgRect.left - containerRect.left
    const imgOffsetY = imgRect.top - containerRect.top

    // Convert crop coordinates to displayed pixels
    const displayX =
      imgOffsetX + this.#modalState.crop.x * this.#modalState.containerScale
    const displayY =
      imgOffsetY + this.#modalState.crop.y * this.#modalState.containerScale
    const displayWidth =
      this.#modalState.crop.width * this.#modalState.containerScale
    const displayHeight =
      this.#modalState.crop.height * this.#modalState.containerScale

    // Apply to overlay (only set initial position, don't override Interact.js transforms)
    if (!overlay.hasAttribute('data-x')) {
      // First time setup
      overlay.style.left = `${displayX}px`
      overlay.style.top = `${displayY}px`
      overlay.style.width = `${displayWidth}px`
      overlay.style.height = `${displayHeight}px`
      overlay.style.transform = 'translate(0px, 0px)'
      overlay.setAttribute('data-x', '0')
      overlay.setAttribute('data-y', '0')
    }

    // Update dimensions display
    this.#updateDimensionsDisplay()
  }

  /**
   * Updates crop dimensions display
   */
  #updateDimensionsDisplay() {
    const dims = document.getElementById('cropDimensions')
    if (!dims) return

    dims.textContent = `${Math.round(
      this.#modalState.crop.width
    )} × ${Math.round(this.#modalState.crop.height)} px (offset: ${Math.round(
      this.#modalState.crop.x
    )}, ${Math.round(this.#modalState.crop.y)})`
  }

  /**
   * Converts overlay position to viewport coordinates (display → viewport conversion).
   *
   * Critical Coordinate Conversion:
   * This method converts FROM display coordinates TO viewport coordinates.
   * Inverse of #updateCropOverlay (which converts viewport → display).
   *
   * Conversion Algorithm:
   * 1. Get overlay bounding box (display coordinates after transform)
   * 2. Get image bounding box (display coordinates)
   * 3. Calculate relative position: overlay.left - image.left
   * 4. Convert to viewport: viewport = display ÷ containerScale
   * 5. Clamp to valid bounds (prevent negative or oversized crops)
   *
   * Why getBoundingClientRect()?:
   * Returns final computed position after CSS transforms.
   * Interact.js modifies transform, so we read back final position.
   *
   * Boundary Clamping:
   * X/Y clamped to [0, viewport.width/height - crop.width/height]
   * Width/Height clamped to [50, viewport.width/height]
   * Prevents invalid configurations (negative coords, too small crops).
   *
   * Minimum Crop Size:
   * 50×50px minimum enforced.
   * Prevents accidentally creating unusable crops.
   *
   * Called On:
   * Every Interact.js drag or resize event.
   * Continuously syncs #modalState.crop with visual overlay position.
   *
   * @param {Object} schedule - Schedule with viewport dimensions for bounds checking
   */
  #updateCropFromTransform(schedule) {
    if (!schedule) return

    const overlay = document.getElementById('cropOverlay')
    const img = document.getElementById('modalPreviewImage')
    if (!overlay || !img) return

    const overlayRect = overlay.getBoundingClientRect()
    const imgRect = img.getBoundingClientRect()

    // Convert displayed pixels back to viewport pixels
    const x =
      (overlayRect.left - imgRect.left) / this.#modalState.containerScale
    const y = (overlayRect.top - imgRect.top) / this.#modalState.containerScale
    const width = overlayRect.width / this.#modalState.containerScale
    const height = overlayRect.height / this.#modalState.containerScale

    // Update modalState (clamped to viewport bounds)
    this.#modalState.crop = {
      x: Math.max(0, Math.min(schedule.viewport.width - width, x)),
      y: Math.max(0, Math.min(schedule.viewport.height - height, y)),
      width: Math.max(50, Math.min(schedule.viewport.width, width)),
      height: Math.max(50, Math.min(schedule.viewport.height, height)),
    }

    this.#updateDimensionsDisplay()
  }

  /**
   * Initializes Interact.js drag and resize on crop overlay.
   *
   * Interact.js Configuration:
   * Two capabilities enabled:
   * 1. draggable() - move overlay by dragging
   * 2. resizable() - resize overlay from any edge/corner
   *
   * Aspect Ratio Locking:
   * Uses interact.modifiers.aspectRatio() to maintain viewport ratio.
   * Example: 800×480 viewport → 5:3 aspect ratio enforced during resize.
   * Ensures crop matches target device dimensions.
   *
   * Transform Data Attributes:
   * Interact.js stores cumulative deltas in data-x and data-y.
   * Initialize to '0' on first setup.
   * Updated incrementally on each drag/resize event.
   *
   * Drag Handler:
   * Receives event.dx and event.dy (pixel deltas since last event).
   * Accumulates into data-x/data-y attributes.
   * Applies CSS transform: translate(x, y)
   * Calls #updateCropFromTransform() to sync viewport coordinates.
   *
   * Resize Handler:
   * Receives event.rect (new size) and event.deltaRect (position delta).
   * Updates both size (width, height) and position (for edge dragging).
   * Edge dragging moves overlay (e.g., dragging left edge moves overlay left).
   * Calls #updateCropFromTransform() to sync viewport coordinates.
   *
   * Resize Edges:
   * All four edges enabled: left, right, top, bottom.
   * Corners automatically work (combines two edges).
   *
   * Unset Previous Instance:
   * Checks overlay.__interact__ to detect existing instance.
   * Calls interact(overlay).unset() to remove old handlers.
   * Prevents duplicate event listeners on re-initialization.
   *
   * Why modifiers.aspectRatio()?:
   * Without it, user could create distorted crops (wrong aspect ratio).
   * Locking to viewport ratio ensures cropped region matches device.
   *
   * equalDelta Parameter:
   * Set to false - allows independent edge dragging.
   * True would force symmetric resize from center (not desired).
   *
   * @param {Object} schedule - Schedule with viewport dimensions for aspect ratio
   */
  #initInteract(schedule) {
    const overlay = document.getElementById('cropOverlay')
    const img = document.getElementById('modalPreviewImage')
    if (!overlay || !img || !schedule) return

    // Remove any existing Interact.js instance
    if (overlay.__interact__) {
      interact(overlay).unset()
    }

    // Store initial position
    overlay.setAttribute('data-x', '0')
    overlay.setAttribute('data-y', '0')

    // Calculate aspect ratio from viewport dimensions
    const aspectRatio = schedule.viewport.width / schedule.viewport.height

    // Make overlay draggable and resizable
    interact('#cropOverlay')
      .draggable({
        listeners: {
          move: (event) => {
            const target = event.target

            // Get current transform
            const x =
              (parseFloat(target.getAttribute('data-x')) || 0) + event.dx
            const y =
              (parseFloat(target.getAttribute('data-y')) || 0) + event.dy

            // Apply transform
            target.style.transform = `translate(${x}px, ${y}px)`
            target.setAttribute('data-x', x)
            target.setAttribute('data-y', y)

            // Update crop coordinates
            this.#updateCropFromTransform(schedule)
          },
        },
      })
      .resizable({
        edges: { left: true, right: true, bottom: true, top: true },
        modifiers: [
          // Lock to viewport aspect ratio
          interact.modifiers.aspectRatio({
            ratio: aspectRatio,
            equalDelta: false,
          }),
        ],
        listeners: {
          move: (event) => {
            const target = event.target
            let x = parseFloat(target.getAttribute('data-x')) || 0
            let y = parseFloat(target.getAttribute('data-y')) || 0

            // Update position for edge dragging
            x += event.deltaRect.left
            y += event.deltaRect.top

            // Update size
            target.style.width = `${event.rect.width}px`
            target.style.height = `${event.rect.height}px`

            // Update position
            target.style.transform = `translate(${x}px, ${y}px)`
            target.setAttribute('data-x', x)
            target.setAttribute('data-y', y)

            // Update crop coordinates
            this.#updateCropFromTransform(schedule)
          },
        },
      })
  }
}
