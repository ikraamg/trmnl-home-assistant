/* global document */
/**
 * Confirm Modal Module
 *
 * Promise-based modal dialogs for confirmations and alerts.
 * Replaces native window.confirm() and window.alert() with styled UI.
 *
 * Design Pattern:
 * Promise-based async/await interface for cleaner code flow.
 * Instead of callbacks, caller awaits modal result:
 * ```js
 * const confirmed = await modal.confirm({...})
 * if (confirmed) { // user clicked Confirm }
 * ```
 *
 * Modal Types:
 * - confirm(): Two buttons (Confirm + Cancel), returns boolean
 * - alert(): One button (OK), returns void, supports type styling
 * - show(): Alias for confirm() (backwards compatibility)
 *
 * Promise Resolution:
 * Stored callbacks (#onConfirm, #onCancel) resolve Promise when user clicks.
 * Both buttons resolve the Promise - no rejection (user can always dismiss).
 *
 * Styling:
 * Tailwind CSS classes for buttons and backdrop.
 * Alert types (info, error, success, warning) apply color-coded buttons.
 * Backdrop overlay prevents clicking outside to dismiss.
 *
 * DOM Management:
 * Modal content lives in #confirmModalContent div (created by ui-renderer.js).
 * Show: Sets content + makes visible, Hide: Removes content + hides.
 *
 * Usage Examples:
 * ```js
 * // Confirmation dialog
 * const confirmed = await modal.confirm({
 *   title: 'Delete?',
 *   message: 'This cannot be undone',
 *   confirmText: 'Delete',
 *   confirmClass: 'bg-red-600'
 * })
 *
 * // Alert dialog
 * await modal.alert({
 *   title: 'Success!',
 *   message: 'Operation completed',
 *   type: 'success'
 * })
 * ```
 *
 * NOTE: Only one modal can be shown at a time (stateful #onConfirm/#onCancel).
 * AI: When adding modal types, preserve Promise-based interface pattern.
 *
 * @module html/js/confirm-modal
 */

/**
 * Promise-based modal dialog manager.
 *
 * Promise Pattern:
 * Methods return Promise that resolves when user clicks button.
 * Enables async/await syntax for cleaner dialog handling.
 *
 * @class
 */
export class ConfirmModal {
  // Private state
  #onConfirm = null
  #onCancel = null

  /**
   * Shows a confirmation modal (with Cancel button)
   * @param {Object} options - Modal configuration
   * @param {string} options.title - Modal title
   * @param {string} options.message - Confirmation message
   * @param {string} [options.confirmText='Confirm'] - Confirm button text
   * @param {string} [options.cancelText='Cancel'] - Cancel button text
   * @param {string} [options.confirmClass='bg-red-600'] - Tailwind classes for confirm button
   * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
   */
  async confirm({
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmClass = 'bg-red-600 hover:bg-red-700',
  }) {
    return new Promise((resolve) => {
      this.#onConfirm = () => {
        this.#hideModal()
        resolve(true)
      }

      this.#onCancel = () => {
        this.#hideModal()
        resolve(false)
      }

      this.#showModal(
        title,
        message,
        confirmText,
        cancelText,
        confirmClass,
        false
      )
    })
  }

  /**
   * Shows an alert modal (OK button only)
   * @param {Object} options - Modal configuration
   * @param {string} options.title - Modal title
   * @param {string} options.message - Alert message
   * @param {string} [options.okText='OK'] - OK button text
   * @param {string} [options.type='info'] - Alert type: 'info', 'error', 'success', 'warning'
   * @returns {Promise<void>} - Resolves when dismissed
   */
  async alert({ title, message, okText = 'OK', type = 'info' }) {
    const typeClasses = {
      info: 'bg-blue-600 hover:bg-blue-700',
      error: 'bg-red-600 hover:bg-red-700',
      success: 'bg-green-600 hover:bg-green-700',
      warning: 'bg-yellow-600 hover:bg-yellow-700',
    }

    return new Promise((resolve) => {
      this.#onConfirm = () => {
        this.#hideModal()
        resolve()
      }

      this.#onCancel = () => {
        this.#hideModal()
        resolve()
      }

      this.#showModal(
        title,
        message,
        okText,
        null,
        typeClasses[type] || typeClasses.info,
        true
      )
    })
  }

  /**
   * Alias for confirm() to maintain backward compatibility
   */
  async show(options) {
    return this.confirm(options)
  }

  /**
   * Shows the modal with given content
   * @param {boolean} alertMode - If true, hides cancel button (alert mode)
   */
  #showModal(title, message, confirmText, cancelText, confirmClass, alertMode) {
    const modal = document.getElementById('confirmModal')
    if (!modal) {
      this.#createModal()
    }

    // Update content
    document.getElementById('confirmTitle').textContent = title
    document.getElementById('confirmMessage').textContent = message
    document.getElementById('confirmBtn').textContent = confirmText
    document.getElementById(
      'confirmBtn'
    ).className = `px-4 py-2 text-white rounded-md transition ${confirmClass}`

    // Show/hide cancel button based on mode
    const cancelBtn = document.getElementById('cancelBtn')
    if (alertMode) {
      cancelBtn.classList.add('hidden')
    } else {
      cancelBtn.classList.remove('hidden')
      cancelBtn.textContent = cancelText
    }

    // Show modal
    document.getElementById('confirmModal').classList.remove('hidden')
    document.getElementById('confirmOverlay').classList.remove('hidden')
  }

  /**
   * Hides the modal
   */
  #hideModal() {
    document.getElementById('confirmModal').classList.add('hidden')
    document.getElementById('confirmOverlay').classList.add('hidden')
  }

  /**
   * Creates the modal HTML if it doesn't exist
   */
  #createModal() {
    const modalHTML = `
      <!-- Overlay -->
      <div id="confirmOverlay" class="hidden fixed inset-0 bg-black bg-opacity-50 z-40"></div>

      <!-- Modal -->
      <div id="confirmModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <!-- Title -->
          <h2 id="confirmTitle" class="text-xl font-semibold text-gray-900 mb-3"></h2>

          <!-- Message -->
          <p id="confirmMessage" class="text-gray-700 mb-6"></p>

          <!-- Buttons -->
          <div class="flex justify-end gap-3">
            <button id="cancelBtn"
              class="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition">
              Cancel
            </button>
            <button id="confirmBtn"
              class="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 transition">
              Confirm
            </button>
          </div>
        </div>
      </div>
    `

    document.body.insertAdjacentHTML('beforeend', modalHTML)

    // Attach event listeners
    document.getElementById('confirmBtn').addEventListener('click', () => {
      if (this.#onConfirm) this.#onConfirm()
    })

    document.getElementById('cancelBtn').addEventListener('click', () => {
      if (this.#onCancel) this.#onCancel()
    })

    // Close on overlay click
    document.getElementById('confirmOverlay').addEventListener('click', () => {
      if (this.#onCancel) this.#onCancel()
    })

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('confirmModal')
        if (modal && !modal.classList.contains('hidden')) {
          if (this.#onCancel) this.#onCancel()
        }
      }
    })
  }
}
