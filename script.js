document.documentElement.classList.add("js");

const header = document.querySelector(".site-header");
const menuButton = document.querySelector(".menu-button");
const mobileMenu = document.querySelector(".mobile-menu");
const waitlistForm = document.querySelector("#waitlist-form");
const successState = document.querySelector("#success-state");
const resetFormButton = document.querySelector("#reset-form");

// Keep the navigation legible as the page moves beneath it.
function syncHeader() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

window.addEventListener("scroll", syncHeader, { passive: true });
syncHeader();

// Mobile navigation is keyboard-friendly and closes after a selection.
function setMenu(open) {
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  mobileMenu.hidden = !open;
  document.body.classList.toggle("menu-open", open);
}

menuButton.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

mobileMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

window.matchMedia("(min-width: 821px)").addEventListener("change", (event) => {
  if (event.matches) setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
    setMenu(false);
    menuButton.focus();
  }
});

// Subtle scroll reveals; content remains fully visible when motion is reduced.
const revealItems = document.querySelectorAll(".reveal");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px" }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

// Frontend-only waitlist validation and confirmation state.
const requiredFields = ["name", "email", "company", "role"];

function errorFor(field) {
  const value = field.value.trim();

  if (!value) return `${field.labels[0].textContent} is required.`;

  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a valid work email.";
  }

  return "";
}

function validateField(field) {
  const message = errorFor(field);
  const errorElement = document.querySelector(`#${field.id}-error`);

  field.setAttribute("aria-invalid", String(Boolean(message)));
  field.setAttribute("aria-describedby", `${field.id}-error`);
  errorElement.textContent = message;
  return !message;
}

requiredFields.forEach((id) => {
  const field = document.querySelector(`#${id}`);
  field.addEventListener("blur", () => validateField(field));
  field.addEventListener("input", () => {
    if (field.getAttribute("aria-invalid") === "true") validateField(field);
  });
  field.addEventListener("change", () => {
    if (field.getAttribute("aria-invalid") === "true") validateField(field);
  });
});

waitlistForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = requiredFields.map((id) => document.querySelector(`#${id}`));
  const valid = fields.map(validateField).every(Boolean);

  if (!valid) {
    fields.find((field) => field.getAttribute("aria-invalid") === "true")?.focus();
    return;
  }

  waitlistForm.hidden = true;
  successState.hidden = false;
  successState.querySelector("h3").focus?.();
});

resetFormButton.addEventListener("click", () => {
  waitlistForm.reset();
  requiredFields.forEach((id) => {
    const field = document.querySelector(`#${id}`);
    field.removeAttribute("aria-invalid");
    document.querySelector(`#${id}-error`).textContent = "";
  });
  successState.hidden = true;
  waitlistForm.hidden = false;
  document.querySelector("#name").focus();
});
