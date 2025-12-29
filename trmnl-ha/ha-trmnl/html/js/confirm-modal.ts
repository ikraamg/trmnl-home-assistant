/**
 * Confirm Modal Module
 *
 * Promise-based modal dialogs for confirmations and alerts.
 *
 * @module html/js/confirm-modal
 */

/** Alert type determines button styling */
type AlertType = 'info' | 'error' | 'success' | 'warning'

/** Confirm modal options */
interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmClass?: string
}

/** Alert modal options */
interface AlertOptions {
  title: string
  message: string
  okText?: string
  type?: AlertType
}

/**
 * Promise-based modal dialog manager.
 */
export class ConfirmModal {
  #onConfirm: (() => void) | null = null
  #onCancel: (() => void) | null = null

  /**
   * Shows a confirmation modal (with Cancel button)
   */
  async confirm({
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmClass = 'bg-red-600 hover:bg-red-700',
  }: ConfirmOptions): Promise<boolean> {
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
   */
  async alert({ title, message, okText = 'OK', type = 'info' }: AlertOptions): Promise<void> {
    const typeClasses: Record<AlertType, string> = {
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
  async show(options: ConfirmOptions): Promise<boolean> {
    return this.confirm(options)
  }

  /**
   * Shows the modal with given content
   */
  #showModal(
    title: string,
    message: string,
    confirmText: string,
    cancelText: string | null,
    confirmClass: string,
    alertMode: boolean
  ): void {
    const modal = document.getElementById('confirmModal')
    if (!modal) {
      this.#createModal()
    }

    document.getElementById('confirmTitle')!.textContent = title
    document.getElementById('confirmMessage')!.textContent = message
    document.getElementById('confirmBtn')!.textContent = confirmText
    document.getElementById('confirmBtn')!.className =
      `px-4 py-2 text-white rounded-md transition ${confirmClass}`

    const cancelBtn = document.getElementById('cancelBtn')!
    if (alertMode) {
      cancelBtn.classList.add('hidden')
    } else {
      cancelBtn.classList.remove('hidden')
      cancelBtn.textContent = cancelText
    }

    document.getElementById('confirmModal')!.classList.remove('hidden')
    document.getElementById('confirmOverlay')!.classList.remove('hidden')
  }

  /**
   * Hides the modal
   */
  #hideModal(): void {
    document.getElementById('confirmModal')!.classList.add('hidden')
    document.getElementById('confirmOverlay')!.classList.add('hidden')
  }

  /**
   * Creates the modal HTML if it doesn't exist
   */
  #createModal(): void {
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

    document.getElementById('confirmBtn')!.addEventListener('click', () => {
      if (this.#onConfirm) this.#onConfirm()
    })

    document.getElementById('cancelBtn')!.addEventListener('click', () => {
      if (this.#onCancel) this.#onCancel()
    })

    document.getElementById('confirmOverlay')!.addEventListener('click', () => {
      if (this.#onCancel) this.#onCancel()
    })

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
