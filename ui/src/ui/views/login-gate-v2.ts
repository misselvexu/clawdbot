import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";
import { renderConnectCommand } from "./connect-command.ts";

/* -------------------------------------------------------
   Animated Characters — pure-CSS cartoon buddies
   whose eyes track the mouse, blink randomly,
   cover their eyes when the user types a secret,
   and peek when show-password is toggled on.
   ------------------------------------------------------- */

interface CharacterState {
  mouseX: number;
  mouseY: number;
  purpleBlink: boolean;
  blueBlink: boolean;
  isHiding: boolean; // user focused on token / password
  isPeeking: boolean; // show-password toggled on while hiding
}

const _charState: CharacterState = {
  mouseX: 0,
  mouseY: 0,
  purpleBlink: false,
  blueBlink: false,
  isHiding: false,
  isPeeking: false,
};

let _initialized = false;
let _blinkTimer1: number | undefined;
let _blinkTimer2: number | undefined;

function initCharacters(): void {
  if (_initialized) {
    return;
  }
  _initialized = true;

  // Mouse tracking
  window.addEventListener("mousemove", (e: MouseEvent) => {
    _charState.mouseX = e.clientX;
    _charState.mouseY = e.clientY;
    requestAnimationFrame(updatePupils);
  });

  // Random blink loops
  scheduleBlink("purple");
  scheduleBlink("blue");
}

function scheduleBlink(who: "purple" | "blue"): void {
  const delay = 3000 + Math.random() * 4000; // 3-7s
  const timer = window.setTimeout(() => {
    if (who === "purple") {
      _charState.purpleBlink = true;
    } else {
      _charState.blueBlink = true;
    }
    refreshBlink(who);
    window.setTimeout(() => {
      if (who === "purple") {
        _charState.purpleBlink = false;
      } else {
        _charState.blueBlink = false;
      }
      refreshBlink(who);
      scheduleBlink(who);
    }, 150);
  }, delay);
  if (who === "purple") {
    _blinkTimer1 = timer;
  } else {
    _blinkTimer2 = timer;
  }
}

function refreshBlink(who: "purple" | "blue"): void {
  const selector = who === "purple" ? ".oc-char--purple .oc-eye" : ".oc-char--blue .oc-eye";
  const eyes = document.querySelectorAll<HTMLElement>(selector);
  const blinking = who === "purple" ? _charState.purpleBlink : _charState.blueBlink;
  eyes.forEach((el) => {
    if (blinking) {
      el.classList.add("is-blinking");
    } else {
      el.classList.remove("is-blinking");
    }
  });
}

function pupilOffset(eyeEl: HTMLElement, maxDist = 6): { x: number; y: number } {
  const rect = eyeEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = _charState.mouseX - cx;
  const dy = _charState.mouseY - cy;
  const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
  const angle = Math.atan2(dy, dx);
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

function updatePupils(): void {
  if (_charState.isHiding) {
    return;
  } // eyes hidden behind hands
  document.querySelectorAll<HTMLElement>(".oc-pupil").forEach((p) => {
    const eye = p.parentElement;
    if (!eye) {
      return;
    }
    const { x, y } = pupilOffset(eye);
    p.style.transform = `translate(${x}px, ${y}px)`;
  });
}

/* Focus / blur helpers for secret fields */
function onSecretFocus(): void {
  _charState.isHiding = true;
  document.querySelectorAll<HTMLElement>(".oc-hands").forEach((h) => {
    h.classList.add("is-covering");
    h.classList.remove("is-peeking");
  });
  // Reset pupils to center
  document.querySelectorAll<HTMLElement>(".oc-pupil").forEach((p) => {
    p.style.transform = "translate(0, -3px)";
  });
  // Characters react
  document.querySelector<HTMLElement>(".oc-char--purple")?.classList.add("is-hiding");
  document.querySelector<HTMLElement>(".oc-char--blue")?.classList.add("is-hiding");
}

function onSecretBlur(): void {
  _charState.isHiding = false;
  _charState.isPeeking = false;
  document.querySelectorAll<HTMLElement>(".oc-hands").forEach((h) => {
    h.classList.remove("is-covering", "is-peeking");
  });
  document
    .querySelector<HTMLElement>(".oc-char--purple")
    ?.classList.remove("is-hiding", "is-peeking");
  document
    .querySelector<HTMLElement>(".oc-char--blue")
    ?.classList.remove("is-hiding", "is-peeking");
  updatePupils();
}

function syncPeek(showToken: boolean, showPassword: boolean): void {
  const peeking = _charState.isHiding && (showToken || showPassword);
  _charState.isPeeking = peeking;
  const purpleHands = document.querySelector<HTMLElement>(".oc-char--purple .oc-hands");
  if (purpleHands) {
    if (peeking) {
      purpleHands.classList.add("is-peeking");
    } else {
      purpleHands.classList.remove("is-peeking");
    }
  }
  const purpleChar = document.querySelector<HTMLElement>(".oc-char--purple");
  if (purpleChar) {
    if (peeking) {
      purpleChar.classList.add("is-peeking");
      purpleChar.classList.remove("is-hiding");
    } else if (_charState.isHiding) {
      purpleChar.classList.remove("is-peeking");
      purpleChar.classList.add("is-hiding");
    }
  }
}

/* -------------------------------------------------------
   Render
   ------------------------------------------------------- */

export function renderLoginGateV2(state: AppViewState) {
  // Kick off mouse-tracking & blink timers on first render
  requestAnimationFrame(() => initCharacters());

  // Sync peek state each render
  requestAnimationFrame(() =>
    syncPeek(state.loginShowGatewayToken, state.loginShowGatewayPassword),
  );

  return html`
    <div class="login-v2">
      <!-- ======== Left: Brand + Characters ======== -->
      <div class="login-v2__left">
        <div class="login-v2__grid"></div>
        <div class="login-v2__blob1"></div>
        <div class="login-v2__blob2"></div>
        <div class="login-v2__blob3"></div>

        <div class="login-v2__brand">
          <div class="login-v2__brand-icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          OpenClaw
        </div>

        <div class="login-v2__stage">${renderCharacters()}</div>

        <div class="login-v2__footer">AI Agent Platform</div>
      </div>

      <!-- ======== Right: Login Form ======== -->
      <div class="login-v2__right">
        <button
          class="login-v2__back"
          @click=${() => {
            (state as Record<string, unknown>)._loginV2 = false;
          }}
          title="Switch to classic login"
        >
          ← Classic
        </button>
        <div class="login-v2__form-wrap">
          <!-- Mobile-only logo -->
          <div class="login-v2__mobile-logo">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            OpenClaw
          </div>

          <div class="login-v2__heading">
            <h1>Welcome back!</h1>
            <p>${t("login.subtitle")}</p>
          </div>

          <div class="login-v2__fields">
            <!-- WS URL -->
            <label class="field">
              <span>${t("overview.access.wsUrl")}</span>
              <input
                .value=${state.settings.gatewayUrl}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.applySettings({ ...state.settings, gatewayUrl: v });
                }}
                placeholder="ws://127.0.0.1:18789"
              />
            </label>

            <!-- Token -->
            <label class="field">
              <span>${t("overview.access.token")}</span>
              <div class="login-v2__secret-row">
                <input
                  type=${state.loginShowGatewayToken ? "text" : "password"}
                  autocomplete="off"
                  spellcheck="false"
                  .value=${state.settings.token}
                  @input=${(e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    state.applySettings({ ...state.settings, token: v });
                  }}
                  placeholder="OPENCLAW_GATEWAY_TOKEN (${t("login.passwordPlaceholder")})"
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      state.connect();
                    }
                  }}
                  @focus=${onSecretFocus}
                  @blur=${onSecretBlur}
                />
                <button
                  type="button"
                  class="btn btn--icon ${state.loginShowGatewayToken ? "active" : ""}"
                  title=${state.loginShowGatewayToken ? "Hide token" : "Show token"}
                  aria-label="Toggle token visibility"
                  aria-pressed=${state.loginShowGatewayToken}
                  @click=${() => {
                    state.loginShowGatewayToken = !state.loginShowGatewayToken;
                  }}
                >
                  ${state.loginShowGatewayToken ? icons.eye : icons.eyeOff}
                </button>
              </div>
            </label>

            <!-- Password -->
            <label class="field">
              <span>${t("overview.access.password")}</span>
              <div class="login-v2__secret-row">
                <input
                  type=${state.loginShowGatewayPassword ? "text" : "password"}
                  autocomplete="off"
                  spellcheck="false"
                  .value=${state.password}
                  @input=${(e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    state.password = v;
                  }}
                  placeholder="${t("login.passwordPlaceholder")}"
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      state.connect();
                    }
                  }}
                  @focus=${onSecretFocus}
                  @blur=${onSecretBlur}
                />
                <button
                  type="button"
                  class="btn btn--icon ${state.loginShowGatewayPassword ? "active" : ""}"
                  title=${state.loginShowGatewayPassword ? "Hide password" : "Show password"}
                  aria-label="Toggle password visibility"
                  aria-pressed=${state.loginShowGatewayPassword}
                  @click=${() => {
                    state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
                  }}
                >
                  ${state.loginShowGatewayPassword ? icons.eye : icons.eyeOff}
                </button>
              </div>
            </label>

            <!-- Connect -->
            <button class="btn primary login-v2__connect" @click=${() => state.connect()}>
              ${t("common.connect")}
            </button>
          </div>

          <!-- Error -->
          ${state.lastError
            ? html`<div class="callout danger login-v2__error">
                <div>${state.lastError}</div>
              </div>`
            : ""}

          <!-- Help -->
          <div class="login-v2__help">
            <div class="login-v2__help-title">${t("overview.connection.title")}</div>
            <ol class="login-v2__steps">
              <li>
                ${t("overview.connection.step1")}${renderConnectCommand("openclaw gateway run")}
              </li>
              <li>
                ${t("overview.connection.step2")} ${renderConnectCommand("openclaw dashboard")}
              </li>
              <li>${t("overview.connection.step3")}</li>
            </ol>
            <div class="login-v2__docs">
              <a
                class="session-link"
                href="https://docs.openclaw.ai/web/dashboard"
                target="_blank"
                rel="noreferrer"
                >${t("overview.connection.docsLink")}</a
              >
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* -------------------------------------------------------
   Characters template (pure CSS / inline SVG)
   ------------------------------------------------------- */

function renderCharacters() {
  return html`
    <div class="oc-characters">
      <!-- Purple character -->
      <div class="oc-char oc-char--purple">
        <div class="oc-face">
          <div class="oc-eye"><div class="oc-pupil"></div></div>
          <div class="oc-eye"><div class="oc-pupil"></div></div>
        </div>
        <div class="oc-mouth"></div>
        <div class="oc-cheek oc-cheek--l"></div>
        <div class="oc-cheek oc-cheek--r"></div>
        <div class="oc-hands">
          <div class="oc-hand"></div>
          <div class="oc-hand"></div>
          <div class="oc-hand"></div>
        </div>
      </div>

      <!-- Blue character -->
      <div class="oc-char oc-char--blue">
        <div class="oc-face">
          <div class="oc-eye"><div class="oc-pupil"></div></div>
          <div class="oc-eye"><div class="oc-pupil"></div></div>
        </div>
        <div class="oc-mouth"></div>
        <div class="oc-cheek oc-cheek--l"></div>
        <div class="oc-cheek oc-cheek--r"></div>
        <div class="oc-hands">
          <div class="oc-hand"></div>
          <div class="oc-hand"></div>
          <div class="oc-hand"></div>
        </div>
      </div>
    </div>
  `;
}
