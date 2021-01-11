/**
 * @license
 * Copyright 2017 Google Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import {AnimationFrame} from '@material/animation/animationframe';
import {MDCFoundation} from '@material/base/foundation';
import {SpecificEventListener} from '@material/base/types';

import {MDCDialogAdapter} from './adapter';
import {cssClasses, numbers, strings} from './constants';

enum AnimationKeys {
  POLL_SCROLL_POS = 'poll_scroll_position'
}

export class MDCDialogFoundation extends MDCFoundation<MDCDialogAdapter> {
  static get cssClasses() {
    return cssClasses;
  }

  static get strings() {
    return strings;
  }

  static get numbers() {
    return numbers;
  }

  static get defaultAdapter(): MDCDialogAdapter {
    return {
      addBodyClass: () => undefined,
      addClass: () => undefined,
      areButtonsStacked: () => false,
      clickDefaultButton: () => undefined,
      eventTargetMatches: () => false,
      getActionFromEvent: () => '',
      getInitialFocusEl: () => null,
      hasClass: () => false,
      isContentScrollable: () => false,
      notifyClosed: () => undefined,
      notifyClosing: () => undefined,
      notifyOpened: () => undefined,
      notifyOpening: () => undefined,
      releaseFocus: () => undefined,
      removeBodyClass: () => undefined,
      removeClass: () => undefined,
      reverseButtons: () => undefined,
      trapFocus: () => undefined,
      registerContentEventHandler: () => undefined,
      deregisterContentEventHandler: () => undefined,
      isScrollableContentAtTop: () => false,
      isScrollableContentAtBottom: () => false,
    };
  }

  private isOpen_ = false;
  private isFullscreen_ = false;
  private animationFrame_ = 0;
  private animationTimer_ = 0;
  private layoutFrame_ = 0;
  private escapeKeyAction_ = strings.CLOSE_ACTION;
  private scrimClickAction_ = strings.CLOSE_ACTION;
  private autoStackButtons_ = true;
  private areButtonsStacked_ = false;
  private suppressDefaultPressSelector = strings.SUPPRESS_DEFAULT_PRESS_SELECTOR;
  private readonly windowScrollHandler: SpecificEventListener<'scroll'>;
  private readonly animFrame: AnimationFrame;

  constructor(adapter?: Partial<MDCDialogAdapter>) {
    super({...MDCDialogFoundation.defaultAdapter, ...adapter});

    this.animFrame = new AnimationFrame();
    this.windowScrollHandler = () => {
      this.handleScrollEvent();
    };
  }

  init() {
    if (this.adapter.hasClass(cssClasses.STACKED)) {
      this.setAutoStackButtons(false);
    }
    this.isFullscreen_ = this.adapter.hasClass(cssClasses.FULLSCREEN);
  }

  destroy() {
    if (this.isOpen_) {
      this.close(strings.DESTROY_ACTION);
    }

    if (this.animationTimer_) {
      clearTimeout(this.animationTimer_);
      this.handleAnimationTimerEnd_();
    }

    if (this.layoutFrame_) {
      cancelAnimationFrame(this.layoutFrame_);
      this.layoutFrame_ = 0;
    }

    if (this.isFullscreen_ && this.adapter.isContentScrollable()) {
      this.adapter.deregisterContentEventHandler(
          'scroll', this.windowScrollHandler);
    }
  }

  open() {
    this.isOpen_ = true;
    this.adapter.notifyOpening();
    this.adapter.addClass(cssClasses.OPENING);
    if (this.isFullscreen_ && this.adapter.isContentScrollable()) {
      this.adapter.registerContentEventHandler(
          'scroll', this.windowScrollHandler);
    }

    // Wait a frame once display is no longer "none", to establish basis for animation
    this.runNextAnimationFrame_(() => {
      this.adapter.addClass(cssClasses.OPEN);
      this.adapter.addBodyClass(cssClasses.SCROLL_LOCK);

      this.layout();

      this.animationTimer_ = setTimeout(() => {
        this.handleAnimationTimerEnd_();
        this.adapter.trapFocus(this.adapter.getInitialFocusEl());
        this.adapter.notifyOpened();
      }, numbers.DIALOG_ANIMATION_OPEN_TIME_MS);
    });
  }

  close(action = '') {
    if (!this.isOpen_) {
      // Avoid redundant close calls (and events), e.g. from keydown on elements that inherently emit click
      return;
    }

    this.isOpen_ = false;
    this.adapter.notifyClosing(action);
    this.adapter.addClass(cssClasses.CLOSING);
    this.adapter.removeClass(cssClasses.OPEN);
    this.adapter.removeBodyClass(cssClasses.SCROLL_LOCK);
    if (this.isFullscreen_ && this.adapter.isContentScrollable()) {
      this.adapter.deregisterContentEventHandler(
          'scroll', this.windowScrollHandler);
    }

    cancelAnimationFrame(this.animationFrame_);
    this.animationFrame_ = 0;

    clearTimeout(this.animationTimer_);
    this.animationTimer_ = setTimeout(() => {
      this.adapter.releaseFocus();
      this.handleAnimationTimerEnd_();
      this.adapter.notifyClosed(action);
    }, numbers.DIALOG_ANIMATION_CLOSE_TIME_MS);
  }

  isOpen() {
    return this.isOpen_;
  }

  getEscapeKeyAction(): string {
    return this.escapeKeyAction_;
  }

  setEscapeKeyAction(action: string) {
    this.escapeKeyAction_ = action;
  }

  getScrimClickAction(): string {
    return this.scrimClickAction_;
  }

  setScrimClickAction(action: string) {
    this.scrimClickAction_ = action;
  }

  getAutoStackButtons(): boolean {
    return this.autoStackButtons_;
  }

  setAutoStackButtons(autoStack: boolean) {
    this.autoStackButtons_ = autoStack;
  }

  getSuppressDefaultPressSelector(): string {
    return this.suppressDefaultPressSelector;
  }

  setSuppressDefaultPressSelector(selector: string) {
    this.suppressDefaultPressSelector = selector;
  }

  layout() {
    if (this.layoutFrame_) {
      cancelAnimationFrame(this.layoutFrame_);
    }
    this.layoutFrame_ = requestAnimationFrame(() => {
      this.layoutInternal_();
      this.layoutFrame_ = 0;
    });
  }

  /** Handles click on the dialog root element. */
  handleClick(evt: MouseEvent) {
    const isScrim =
        this.adapter.eventTargetMatches(evt.target, strings.SCRIM_SELECTOR);
    // Check for scrim click first since it doesn't require querying ancestors.
    if (isScrim && this.scrimClickAction_ !== '') {
      this.close(this.scrimClickAction_);
    } else {
      const action = this.adapter.getActionFromEvent(evt);
      if (action) {
        this.close(action);
      }
    }
  }

  /** Handles keydown on the dialog root element. */
  handleKeydown(evt: KeyboardEvent) {
    const isEnter = evt.key === 'Enter' || evt.keyCode === 13;
    if (!isEnter) {
      return;
    }
    const action = this.adapter.getActionFromEvent(evt);
    if (action) {
      // Action button callback is handled in `handleClick`,
      // since space/enter keydowns on buttons trigger click events.
      return;
    }

    // `composedPath` is used here, when available, to account for use cases
    // where a target meant to suppress the default press behaviour
    // may exist in a shadow root.
    // For example, a textarea inside a web component:
    // <mwc-dialog>
    //   <horizontal-layout>
    //     #shadow-root (open)
    //       <mwc-textarea>
    //         #shadow-root (open)
    //           <textarea></textarea>
    //       </mwc-textarea>
    //   </horizontal-layout>
    // </mwc-dialog>
    const target = evt.composedPath ? evt.composedPath()[0] : evt.target;
    const isDefault = !this.adapter.eventTargetMatches(
        target, this.suppressDefaultPressSelector);
    if (isEnter && isDefault) {
      this.adapter.clickDefaultButton();
    }
  }

  /** Handles keydown on the document. */
  handleDocumentKeydown(evt: KeyboardEvent) {
    const isEscape = evt.key === 'Escape' || evt.keyCode === 27;
    if (isEscape && this.escapeKeyAction_ !== '') {
      this.close(this.escapeKeyAction_);
    }
  }

  /**
   * Handles scroll event on the dialog's content element -- showing a scroll
   * divider on the header or footer based on the scroll position. This handler
   * should only be registered on full-screen dialogs with scrollable content.
   */
  private handleScrollEvent() {
    // Since scroll events can fire at a high rate, we throttle these events by
    // using requestAnimationFrame.
    this.animFrame.request(AnimationKeys.POLL_SCROLL_POS, () => {
      this.showScrollDividerHeader();
      this.showScrollDividerFooter();
    });
  }

  private layoutInternal_() {
    if (this.autoStackButtons_) {
      this.detectStackedButtons_();
    }
    this.detectScrollableContent_();
    if (this.adapter.isContentScrollable() && this.isFullscreen_) {
      // If dialog is full-screen and scrollable, check if a scroll divider
      // should be shown.
      this.showScrollDividerHeader();
      this.showScrollDividerFooter();
    }
  }

  private handleAnimationTimerEnd_() {
    this.animationTimer_ = 0;
    this.adapter.removeClass(cssClasses.OPENING);
    this.adapter.removeClass(cssClasses.CLOSING);
  }

  /**
   * Runs the given logic on the next animation frame, using setTimeout to factor in Firefox reflow behavior.
   */
  private runNextAnimationFrame_(callback: () => void) {
    cancelAnimationFrame(this.animationFrame_);
    this.animationFrame_ = requestAnimationFrame(() => {
      this.animationFrame_ = 0;
      clearTimeout(this.animationTimer_);
      this.animationTimer_ = setTimeout(callback, 0);
    });
  }

  private detectStackedButtons_() {
    // Remove the class first to let us measure the buttons' natural positions.
    this.adapter.removeClass(cssClasses.STACKED);

    const areButtonsStacked = this.adapter.areButtonsStacked();

    if (areButtonsStacked) {
      this.adapter.addClass(cssClasses.STACKED);
    }

    if (areButtonsStacked !== this.areButtonsStacked_) {
      this.adapter.reverseButtons();
      this.areButtonsStacked_ = areButtonsStacked;
    }
  }

  private detectScrollableContent_() {
    // Remove the class first to let us measure the natural height of the content.
    this.adapter.removeClass(cssClasses.SCROLLABLE);
    if (this.adapter.isContentScrollable()) {
      this.adapter.addClass(cssClasses.SCROLLABLE);
    }
  }

  private showScrollDividerHeader() {
    if (!this.adapter.isScrollableContentAtTop()) {
      this.adapter.addClass(cssClasses.SCROLL_DIVIDER_HEADER);
    } else if (this.adapter.hasClass(cssClasses.SCROLL_DIVIDER_HEADER)) {
      this.adapter.removeClass(cssClasses.SCROLL_DIVIDER_HEADER);
    }
  }

  private showScrollDividerFooter() {
    if (!this.adapter.isScrollableContentAtBottom()) {
      this.adapter.addClass(cssClasses.SCROLL_DIVIDER_FOOTER);
    } else if (this.adapter.hasClass(cssClasses.SCROLL_DIVIDER_FOOTER)) {
      this.adapter.removeClass(cssClasses.SCROLL_DIVIDER_FOOTER);
    }
  }
}

// tslint:disable-next-line:no-default-export Needed for backward compatibility with MDC Web v0.44.0 and earlier.
export default MDCDialogFoundation;
