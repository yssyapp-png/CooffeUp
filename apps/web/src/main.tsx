import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PaymentCallback } from "./payments/PaymentCallback";
import "./styles.css";
const Page = location.pathname === "/payment/callback" ? PaymentCallback : App;
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Page /></React.StrictMode>);
