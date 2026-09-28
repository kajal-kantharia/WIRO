class GiftWrapping {
  constructor(container) {
    this.container = container;
    this.toggle = container.querySelector('[data-gift-wrapping-toggle]');
    this.fields = container.querySelector('[data-gift-wrapping-fields]');
    this.inputs = container.querySelectorAll('[data-gift-wrapping-input]');
    this.idInput = container.querySelector('[data-gift-wrapping-id]');
    this.error = container.querySelector('[data-gift-wrapping-error]');
    this.stock = container.querySelector('[data-gift-wrap-stock]');
    this.form = this.inputs[0]?.form;
    this.wrapVariantId = container.dataset.giftWrapVariant;
    this.wrapPrice = container.dataset.giftWrapPrice;
    this.wrapInventory = container.dataset.giftWrapInventory;

    this.toggle.addEventListener('change', () => this.updateToggle());
    this.form?.addEventListener('submit', (event) => this.handleFormSubmit(event), true);
    this.inputs.forEach((input) => {
      input.addEventListener('input', () => this.clearError());
    });
    subscribe(PUB_SUB_EVENTS.cartUpdate, () => this.updateAvailability());
    this.updateToggle();
  }

  updateToggle() {
    const enabled = this.toggle.checked;
    this.fields.hidden = !enabled;
    this.inputs.forEach((input) => {
      input.disabled = !enabled;
      input.required = enabled && input.type !== 'hidden';
    });
    this.idInput.disabled = !enabled;

    if (enabled && !this.idInput.value) {
      const wrapKey = this.wrapVariantId || 'free';
      this.idInput.value = `${wrapKey}--${this.wrapInventory}--gift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    this.clearError();
  }

  handleFormSubmit(event) {
    if (!this.toggle.checked) return;

    const missingInput = [...this.inputs].find((input) => input.type !== 'hidden' && !input.value.trim());
    if (missingInput) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.showError(missingInput);
      missingInput.focus();
      return;
    }

    if (!this.wrapVariantId) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.addGiftWrappedItemsToCart();
  }

  async addGiftWrappedItemsToCart() {
    const submitButton = this.form.querySelector('[type="submit"]');
    const formData = new FormData(this.form);
    const quantity = Number(formData.get('quantity')) || 1;
    const properties = {};
    formData.forEach((value, key) => {
      const match = key.match(/^properties\[(.*)\]$/);
      if (match) properties[match[1]] = value;
    });

    const cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
    const payload = {
      items: [
        { id: formData.get('id'), quantity, properties },
        {
          id: this.wrapVariantId,
          quantity,
          properties: { '_Gift wrapping for': this.idInput.value },
        },
      ],
    };
    properties['_Gift wrapping variant'] = this.wrapVariantId;
    properties['_Gift wrapping price'] = this.wrapPrice;

    if (cart) {
      payload.sections = cart.getSectionsToRender().map((section) => section.id);
      payload.sections_url = window.location.pathname;
      cart.setActiveElement?.(document.activeElement);
    }

    submitButton?.setAttribute('aria-disabled', 'true');
    submitButton?.classList.add('loading');

    try {
      const response = await fetch(routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.description || 'Unable to add gift wrapping.');

      if (cart) {
        cart.renderContents({ ...result, key: result.items[0].key, id: result.items[0].id });
      } else {
        window.location = routes.cart_url;
      }
      await this.updateAvailability();
    } catch (error) {
      this.showErrorMessage(error.message);
    } finally {
      submitButton?.removeAttribute('aria-disabled');
      submitButton?.classList.remove('loading');
    }
  }

  showError(input) {
    const label = this.container.querySelector(`label[for="${input.id}"]`);
    this.showErrorMessage(`Please enter ${label.textContent.toLowerCase()}.`);
  }

  showErrorMessage(message) {
    if (!this.error) return;
    this.error.textContent = message;
    this.error.hidden = false;
  }

  clearError() {
    if (!this.error) return;
    this.error.textContent = '';
    this.error.hidden = true;
  }

  async updateAvailability() {
    if (!this.wrapVariantId) return;
    try {
      const cart = await fetch(`${routes.cart_url}.js`).then((response) => response.json());
      const inCart = cart.items
        .filter((item) => String(item.variant_id) === String(this.wrapVariantId) && item.properties?.['_Gift wrapping for'])
        .reduce((total, item) => total + item.quantity, 0);
      const remaining = Math.max(0, Number(this.wrapInventory) - inCart);
      if (this.stock) this.stock.textContent = `Only ${remaining} left`;
      if (remaining === 0 && this.toggle.checked) {
        this.toggle.checked = false;
        this.updateToggle();
      }
      this.toggle.disabled = remaining === 0;
    } catch (error) {}
  }
}

function initGiftWrapping(scope = document) {
  scope.querySelectorAll('[data-gift-wrapping]').forEach((container) => {
    if (!container.dataset.giftWrappingInitialized) {
      container.dataset.giftWrappingInitialized = 'true';
      new GiftWrapping(container);
    }
  });
}

async function refreshGiftWrappingCart(block) {
  try {
    const cart = await fetch(`${routes.cart_url}.js`).then((response) => response.json());
    document.querySelectorAll('.cart-count-bubble [aria-hidden="true"]').forEach((count) => {
      count.textContent = cart.item_count;
    });
    const button = document.getElementById('cart-notification-button');
    if (button) {
      button.dataset.label ||= button.textContent.replace(/\s*\(\d+\)\s*$/, '').trim();
      button.textContent = `${button.dataset.label} (${cart.item_count})`;
    }
    publish(PUB_SUB_EVENTS.cartUpdate, { source: 'gift-wrapping', cartData: cart });
  } catch (error) {}

  const productNode = block.closest('[id^="cart-notification-product-"]');
  if (!productNode) return;
  fetch(`${routes.cart_url}?section_id=cart-notification-product`)
    .then((response) => response.text())
    .then((html) => {
      const nextNode = new DOMParser().parseFromString(html, 'text/html').querySelector(`#${productNode.id}`);
      if (nextNode) productNode.replaceWith(nextNode);
    });
}

document.addEventListener('DOMContentLoaded', () => initGiftWrapping());
document.addEventListener('shopify:section:load', (event) => initGiftWrapping(event.target));

class CartGiftWrapping {
  constructor() {
    document.addEventListener('click', (event) => this.handleClick(event));
    document.addEventListener('change', (event) => this.handleChange(event));
  }

  handleClick(event) {
    const submitButton = event.target.closest('[data-gift-submit]');
    if (submitButton) {
      this.handleSubmit(submitButton);
      return;
    }

    const button = event.target.closest('[data-gift-edit], [data-gift-cancel]');
    if (!button) return;
    const block = button.closest('[data-gift-wrapping-cart]');
    if (!block) return;
    button.hasAttribute('data-gift-edit') ? this.openEditForm(block) : this.closeForm(block);
  }

  async handleChange(event) {
    const checkbox = event.target.closest('[data-gift-cart-toggle]');
    if (!checkbox) return;
    const block = checkbox.closest('[data-gift-wrapping-cart]');
    if (!block) return;
    if (checkbox.checked) return this.openAddForm(block);

    try {
      const cart = await this.getCart();
      if (this.findWrapItem(cart, block.dataset.giftId)) return this.removeGiftWrap(block);

      // A saved cart can occasionally contain the main-item properties after
      // its linked wrap line has been removed. Clean that stale state only;
      // a newly opened, blank form does not make a cart request.
      if (block.dataset.giftWrapActive === 'Yes') {
        await this.changeMainProduct(block, { '_Gift wrapping id': block.dataset.giftId });
        this.showInactiveState(block);
        refreshGiftWrappingCart(block);
        return;
      }
    } catch (error) {
      checkbox.checked = true;
      return;
    }
    this.closeForm(block);
  }

  async handleSubmit(button) {
    const form = button.closest('[data-gift-edit-form]');
    if (!form) return;
    if (!this.validateForm(form)) return;

    const block = form.closest('[data-gift-wrapping-cart]');
    if (!block) return;
    const values = Object.fromEntries(
      [...form.querySelectorAll('[name]')].map((field) => [field.name, field.value])
    );
    button.disabled = true;

    try {
      const cart = await this.getCart();
      const mainItem = this.findMainItem(cart, block.dataset.giftId);
      const wrapItem = this.findWrapItem(cart, block.dataset.giftId);
      const isFreeWrap = block.dataset.giftWrapVariant === 'free';
      if (!mainItem) throw new Error('Main cart item was not found.');
      if (!isFreeWrap && !wrapItem) await this.addWrapProduct(block, mainItem.quantity);
      const properties = {
        'Gift wrapping': 'Yes',
        '_Gift wrapping id': block.dataset.giftId,
        '_Gift wrapping active': 'Yes',
        ...values,
      };
      if (!isFreeWrap) {
        properties['_Gift wrapping variant'] = block.dataset.giftWrapVariant;
        properties['_Gift wrapping price'] = block.dataset.giftWrapPrice;
      }
      await this.changeMainProduct(block, properties);
      const ui = this.getUI(block);
      if (ui.summary) {
        ui.summary.textContent = `To: ${values.To} / From: ${values.From} / “${values['Gift message']}”`;
      }
      form.hidden = true;
      if (ui.edit) ui.edit.hidden = false;
      if (ui.cancel) ui.cancel.hidden = true;
      if (ui.summary) ui.summary.hidden = false;
      block.dataset.giftWrapActive = 'Yes';
      refreshGiftWrappingCart(block);
    } catch (error) {
      // Keep the form usable when Shopify returns an error.
    } finally {
      button.disabled = false;
    }
  }

  openEditForm(block) {
    const ui = this.getUI(block);
    if (!ui.form) return;
    ui.form.hidden = false;
    if (ui.edit) ui.edit.hidden = true;
    if (ui.cancel) ui.cancel.hidden = false;
  }

  openAddForm(block) {
    const ui = this.getUI(block);
    const { form } = ui;
    if (!form) return;
    form.querySelectorAll('input, textarea').forEach((input) => {
      input.value = '';
    });
    const submitButton = form.querySelector('[data-gift-submit]');
    if (submitButton) submitButton.textContent = 'Add';
    form.hidden = false;
    if (ui.edit) ui.edit.hidden = true;
    if (ui.cancel) ui.cancel.hidden = true;
    if (ui.summary) ui.summary.hidden = true;
  }

  closeForm(block) {
    const active = block.dataset.giftWrapActive === 'Yes';
    const ui = this.getUI(block);
    if (ui.form) ui.form.hidden = true;
    if (ui.edit) ui.edit.hidden = !active;
    if (ui.cancel) ui.cancel.hidden = true;
    if (ui.summary) ui.summary.hidden = !active;
  }

  async removeGiftWrap(block) {
    try {
      const cart = await this.getCart();
      if (!this.findWrapItem(cart, block.dataset.giftId)) return this.closeForm(block);

      await this.changeMainProduct(block, { '_Gift wrapping id': block.dataset.giftId });
      const updatedCart = await this.getCart();
      const wrapItem = this.findWrapItem(updatedCart, block.dataset.giftId);
      if (wrapItem) await this.changeLine(wrapItem.line, 0);
      this.showInactiveState(block);
      refreshGiftWrappingCart(block);
    } catch (error) {
      const toggle = this.getUI(block).toggle;
      if (toggle) toggle.checked = true;
    }
  }

  async addWrapProduct(block, quantity) {
    const response = await fetch(routes.cart_add_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        items: [{
          id: block.dataset.giftWrapVariant,
          quantity,
          properties: { '_Gift wrapping for': block.dataset.giftId },
        }],
      }),
    });
    if (!response.ok) throw new Error('Unable to add gift wrapping.');
  }

  async changeMainProduct(block, properties) {
    const cart = await this.getCart();
    const mainItem = this.findMainItem(cart, block.dataset.giftId);
    if (!mainItem) throw new Error('Main cart item was not found.');
    return this.changeLine(mainItem.line, mainItem.quantity, properties);
  }

  async getCart() {
    const response = await fetch(`${routes.cart_url}.js`);
    if (!response.ok) throw new Error('Unable to read the cart.');
    return response.json();
  }

  findMainItem(cart, giftId) {
    return this.findCartItem(cart, (item) => item.properties?.['_Gift wrapping id'] === giftId);
  }

  findWrapItem(cart, giftId) {
    return this.findCartItem(cart, (item) => item.properties?.['_Gift wrapping for'] === giftId);
  }

  findCartItem(cart, matches) {
    const index = cart.items.findIndex(matches);
    return index === -1 ? null : { ...cart.items[index], line: index + 1 };
  }

  showInactiveState(block) {
    const ui = this.getUI(block);
    if (ui.toggle) ui.toggle.checked = false;
    ui.form?.querySelectorAll('input, textarea').forEach((input) => {
      input.value = '';
    });
    if (ui.form) ui.form.hidden = true;
    if (ui.edit) ui.edit.hidden = true;
    if (ui.cancel) ui.cancel.hidden = true;
    if (ui.summary) ui.summary.hidden = true;
    block.dataset.giftWrapActive = 'No';
    delete block.dataset.giftWrapPending;
  }

  getUI(block) {
    return {
      toggle: block.querySelector('[data-gift-cart-toggle]'),
      form: block.querySelector('[data-gift-edit-form]'),
      edit: block.querySelector('[data-gift-edit]'),
      cancel: block.querySelector('[data-gift-cancel]'),
      summary: block.querySelector('[data-gift-summary]'),
    };
  }

  validateForm(form) {
    return [...form.querySelectorAll('input, textarea')].every((field) => field.reportValidity());
  }

  async changeLine(line, quantity, properties) {
    const response = await fetch(routes.cart_change_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ line, quantity, ...(properties && { properties }) }),
    });
    if (!response.ok) throw new Error('Unable to update gift wrapping.');
  }
}

document.addEventListener('DOMContentLoaded', () => new CartGiftWrapping());
