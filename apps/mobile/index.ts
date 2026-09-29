import { registerRootComponent } from "expo";
import App from "./App";

// Explicit entry point: in this monorepo Expo lives in the root node_modules, so the default
// "node_modules/expo/AppEntry.js" path cannot be resolved from this package.
registerRootComponent(App);
