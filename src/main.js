import "./styles.css";
import { createApp } from "./app.js";

const root = document.querySelector("#app");

if (root) {
  createApp(root);
}
