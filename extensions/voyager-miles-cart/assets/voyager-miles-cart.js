/**
 * SAA Voyager Miles Cart Extension
 * Handles Voyager login, points display, and integration with checkout
 */

console.log("🚀 VoyagerMilesCart JavaScript file loaded!");

class VoyagerMilesCart {
  constructor() {
    this.block = document.querySelector(".voyager-miles-cart-block");
    if (!this.block) {
      console.log("[Voyager] Block not found in DOM");
      return;
    }
    this.totalPoints = 0;
    this.cartTotal = 0;

    // Store instance globally for re-initialization
    window.voyagerMilesCartInstance = this;

    // Init is async, but we don't need to await it in constructor
    this.init().catch((error) => {
      console.error("[Voyager] Error during initialization:", error);
    });
  }

  async init() {
    this.apiUrl = this.block.dataset.voyagerApiUrl;
    this.settingsApiUrl =
      "https://saa-voyager-app-prod.tofmail2022.workers.dev/api/settings/points-rate";
    this.pointsRate = parseFloat(this.block.dataset.pointsRate) || 0.1; // Default fallback
    this.minPoints = parseInt(this.block.dataset.minPoints) || 1000;
    this.maxPoints = parseInt(this.block.dataset.maxPoints) || 50000;

    this.loginForm = document.getElementById("voyager-login-form");
    this.pointsDisplay = document.getElementById("voyager-points-display");
    this.statusDiv = document.getElementById("voyager-status");
    this.pointsStatusDiv = document.getElementById("points-status");

    // Fetch conversion rate from API
    await this.fetchConversionRate();

    this.bindEvents();
    this.checkExistingSession();
    this.moveAboveSubtotal();
  }

  async fetchConversionRate() {
    try {
      console.log(
        "[Voyager Cart] Fetching conversion rate from:",
        this.settingsApiUrl
      );
      const response = await fetch(this.settingsApiUrl);

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.pointsToZarRate) {
          const rate = parseFloat(data.pointsToZarRate);
          if (!isNaN(rate) && rate > 0) {
            console.log("[Voyager Cart] Conversion rate loaded:", rate);
            this.pointsRate = rate;
            return;
          }
        }
      }
      console.warn(
        "[Voyager Cart] Failed to fetch conversion rate, using default:",
        this.pointsRate
      );
    } catch (error) {
      console.error("[Voyager Cart] Error fetching conversion rate:", error);
      // Keep using default rate
    }
  }

  bindEvents() {
    // Header click handler to show/hide login form
    const headerBtn = document.getElementById("voyager-header-btn");
    if (headerBtn) {
      headerBtn.addEventListener("click", () => {
        this.toggleLoginForm();
      });
    }

    if (this.loginForm) {
      this.loginForm.addEventListener("submit", (e) => this.handleLogin(e));
    }

    // Add manual click handler as backup
    const loginBtn = document.getElementById("voyager-login-btn");
    if (loginBtn) {
      console.log("Adding click event listener to login button as backup");
      loginBtn.addEventListener("click", (e) => {
        console.log("Login button clicked manually");
        e.preventDefault();
        this.handleLogin(e);
      });
    }

    // Cancel buttons
    const cancelBtn = document.getElementById("voyager-cancel-btn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        this.loginForm.reset();
        this.hideStatus();
        // Hide the login form section
        const milesSection = document.getElementById("voyager-miles-section");
        if (milesSection) {
          milesSection.style.display = "none";
        }
      });
    }

    const cancelPointsBtn = document.getElementById(
      "voyager-cancel-points-btn"
    );
    if (cancelPointsBtn) {
      cancelPointsBtn.addEventListener("click", () => {
        const zarInput = document.getElementById("zar-to-use");
        if (zarInput) zarInput.value = "";
        this.clearPointsStatus();
        this.updateTotalAfterMiles(0);
      });
    }
    
    // Check if discount is already applied and show remove button
    this.checkAndShowRemoveDiscountButton();

    // Tab navigation - removed click handlers (tabs are display-only)

    const applyBtn = document.getElementById("apply-points");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => this.handleApplyPoints());
    }

    const zarInput = document.getElementById("zar-to-use");
    if (zarInput) {
      zarInput.addEventListener("input", (e) => this.handleZarInput(e));
    }

    // Logout button
    const logoutBtn = document.getElementById("voyager-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => this.handleLogout());
    }

    // Fetch cart total on init
    this.fetchCartTotal();
  }

  async handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById("voyager-username").value.trim();
    const password = document.getElementById("voyager-password").value.trim();
    const apiUrl = this.block.dataset.voyagerApiUrl;

    if (!username || !password) {
      this.showStatus("Please enter both Voyager Number and PIN", "error");
      return;
    }

    console.log("Login attempt:", { username, apiUrl });

    try {
      this.showStatus("Logging in...", "info");
      this.setLoading(true);

      const response = await fetch(`${apiUrl}/authenticate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      console.log("Response received:", response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.log("Login error data:", errorData);

        if (response.status === 401) {
          this.showStatus("Invalid credentials. Please try again.", "error");
        } else {
          this.showStatus(
            `Login failed: ${errorData.message || "Unknown error"}`,
            "error"
          );
        }
        return;
      }

      const data = await response.json();

      if (data.success) {
        // Store session data in localStorage
        localStorage.setItem("voyager_session_id", data.sessionId);
        localStorage.setItem("voyager_member_number", username);
        
        // Also store in cookie for checkout extension access (may not work due to cross-domain)
        // Cookie expires in 1 hour (3600 seconds)
        const cookieExpiry = new Date(Date.now() + 3600 * 1000).toUTCString();
        document.cookie = `voyager_session_id=${data.sessionId}; expires=${cookieExpiry}; path=/; SameSite=Lax`;
        document.cookie = `voyager_member_number=${username}; expires=${cookieExpiry}; path=/; SameSite=Lax`;
        console.log("[Voyager] Session stored in cookie for checkout access");

        // IMPORTANT: Store session in cart attributes immediately after login
        // This ensures it's available when user proceeds to checkout
        await this.storeSessionInCartAttributes(data.sessionId, username);

        this.showStatus("Login successful! Fetching points...", "success");

        // Fetch account summary
        await this.fetchAccountSummary();

        // Show points display
        document.getElementById("voyager-login-form").style.display = "none";
        document.getElementById("voyager-points-display").style.display =
          "block";
      } else {
        this.showStatus(`Login failed: ${data.message}`, "error");
      }
    } catch (error) {
      console.error("Login error:", error);
      this.showStatus(
        "Network error. Please check your connection and try again.",
        "error"
      );
    } finally {
      this.setLoading(false);
    }
  }

  async handleLoginSuccess(data) {
    // Store session data
    localStorage.setItem("voyager_session_id", data.sessionId);
    localStorage.setItem("voyager_member_number", data.memberNumber);

    // Fetch account summary
    await this.fetchAccountSummary();

    this.showStatus("Login successful!", "success");
    this.showPointsDisplay();
  }

  async fetchAccountSummary() {
    try {
      const sessionId = localStorage.getItem("voyager_session_id");

      const response = await fetch(`${this.apiUrl}/account-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
      });

      if (response.ok) {
        const data = await response.json();
        this.displayPoints(data.points);
      } else {
        throw new Error("Failed to fetch points balance");
      }
    } catch (error) {
      console.error("Error fetching account summary:", error);
      this.showStatus("Failed to fetch points balance", "error");
    }
  }

  displayPoints(points) {
    this.totalPoints = Number(points) || 0;
    const pointsValue = document.getElementById("points-value");
    const zarValue = document.getElementById("zar-value");

    if (pointsValue) {
      pointsValue.textContent = this.totalPoints.toLocaleString();
    }

    if (zarValue) {
      const zarAmount = (this.totalPoints * this.pointsRate).toFixed(2);
      zarValue.textContent = `R ${zarAmount}`;
    }

    // Update cart total and total after miles
    this.fetchCartTotal();
    this.updateTotalAfterMiles(0);

    // Store points data for checkout integration
    localStorage.setItem("voyager_total_points", this.totalPoints.toString());
    localStorage.setItem("voyager_points_rate", this.pointsRate.toString());
  }

  async handleLogout() {
    console.log("[Voyager] Logging out...");
    
    try {
      // Clear all Voyager-related localStorage
      localStorage.removeItem("voyager_session_id");
      localStorage.removeItem("voyager_member_number");
      localStorage.removeItem("voyager_total_points");
      localStorage.removeItem("voyager_points_rate");
      localStorage.removeItem("voyager_cart_session_id");
      localStorage.removeItem("voyager_cart_member_number");

      // Clear cart attributes
      try {
        await fetch("/cart/update.js", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            attributes: {
              voyager_points_used: "",
              voyager_points_rate: "",
              voyager_session_id: "",
              voyager_member_number: "",
              voyager_total_points: "",
              voyager_remaining_points: "",
              voyager_discount_amount: "",
              voyager_points_value: "",
            },
          }),
        });
        console.log("[Voyager] Cart attributes cleared");
      } catch (error) {
        console.error("[Voyager] Error clearing cart attributes:", error);
      }

      // Reset UI
      this.totalPoints = 0;
      this.cartTotal = 0;

      // Hide points display and show login form
      const pointsDisplay = document.getElementById("voyager-points-display");
      const loginForm = document.getElementById("voyager-login-form");
      
      if (pointsDisplay) {
        pointsDisplay.style.display = "none";
      }
      if (loginForm) {
        loginForm.style.display = "block";
        // Clear form fields
        const usernameInput = document.getElementById("voyager-username");
        const passwordInput = document.getElementById("voyager-password");
        if (usernameInput) usernameInput.value = "";
        if (passwordInput) passwordInput.value = "";
      }

      // Clear status messages
      this.hideStatus();
      this.clearPointsStatus();

      // Reset total after miles
      this.updateTotalAfterMiles(0);

      // Clear ZAR input
      const zarInput = document.getElementById("zar-to-use");
      if (zarInput) {
        zarInput.value = "";
      }
      const pointsDisplayElement = document.getElementById("zar-to-points-display");
      if (pointsDisplayElement) {
        pointsDisplayElement.textContent = "";
      }

      console.log("[Voyager] Logout successful");
      this.showStatus("Logged out successfully", "success");
      
      // Hide status after 2 seconds
      setTimeout(() => {
        this.hideStatus();
      }, 2000);

    } catch (error) {
      console.error("[Voyager] Error during logout:", error);
      this.showStatus("Error during logout. Please try again.", "error");
    }
  }

  async fetchCartTotal() {
    try {
      // Try to get cart total from Shopify cart API
      const response = await fetch("/cart.js", {
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        const cart = await response.json();
        const cartTotal = (cart.total_price / 100).toFixed(2); // Convert from cents
        const cartTotalElement = document.getElementById("cart-total");
        if (cartTotalElement) {
          cartTotalElement.textContent = `R ${cartTotal}`;
        }
        this.cartTotal = parseFloat(cartTotal);
        return this.cartTotal;
      }
    } catch (error) {
      console.error("[Voyager] Error fetching cart total:", error);
    }

    // Fallback: try to get from DOM
    try {
      const subtotalElements = document.querySelectorAll(
        '[class*="subtotal"], [class*="cart-total"], [id*="subtotal"], [id*="cart-total"]'
      );
      for (const element of subtotalElements) {
        const text = element.textContent || "";
        const match = text.match(/R\s*([\d,]+\.?\d*)/);
        if (match) {
          const total = parseFloat(match[1].replace(/,/g, ""));
          if (!isNaN(total)) {
            const cartTotalElement = document.getElementById("cart-total");
            if (cartTotalElement) {
              cartTotalElement.textContent = `R ${total.toFixed(2)}`;
            }
            this.cartTotal = total;
            return this.cartTotal;
          }
        }
      }
    } catch (error) {
      console.error("[Voyager] Error parsing cart total from DOM:", error);
    }

    // Default fallback
    this.cartTotal = 0;
    const cartTotalElement = document.getElementById("cart-total");
    if (cartTotalElement) {
      cartTotalElement.textContent = "R 0.00";
    }
    return 0;
  }

  updateTotalAfterMiles(milesDiscount) {
    const totalAfterElement = document.getElementById("total-after-miles");
    if (totalAfterElement && typeof this.cartTotal === "number") {
      const totalAfter = Math.max(0, this.cartTotal - milesDiscount);
      totalAfterElement.textContent = `R ${totalAfter.toFixed(2)}`;
    }
  }

  handleZarInput(e) {
    const zarValue = parseFloat(e.target.value);
    const applyBtn = document.getElementById("apply-points");

    if (!zarValue || zarValue <= 0) {
      applyBtn.disabled = true;
      this.clearPointsStatus();
      this.updateTotalAfterMiles(0);
      return;
    }

    // Calculate points needed for this ZAR amount
    const pointsNeeded = Math.ceil(zarValue / this.pointsRate);
    const minZar = this.minPoints * this.pointsRate;
    const maxZar = this.maxPoints * this.pointsRate;
    const maxAvailableZar = this.totalPoints * this.pointsRate;

    if (zarValue < minZar || zarValue > maxZar) {
      applyBtn.disabled = true;
      this.showPointsStatus(
        `Discount amount must be between R${minZar.toFixed(
          2
        )} and R${maxZar.toFixed(2)}`,
        "error"
      );
      this.updateTotalAfterMiles(0);
    } else if (zarValue > maxAvailableZar) {
      applyBtn.disabled = true;
      this.showPointsStatus(
        `You can only discount up to R${maxAvailableZar.toFixed(
          2
        )} (${this.totalPoints.toLocaleString()} points)`,
        "error"
      );
      this.updateTotalAfterMiles(0);
    } else {
      applyBtn.disabled = false;
      this.clearPointsStatus();
      // Show equivalent points for this ZAR amount
      const pointsDisplay = document.getElementById("zar-to-points-display");
      if (pointsDisplay) {
        pointsDisplay.textContent = `(${pointsNeeded.toLocaleString()} points)`;
      }
      // Update total after miles preview
      this.updateTotalAfterMiles(zarValue);
    }
  }

  async handleApplyPoints() {
    // Get ZAR input safely
    const zarInputElement = document.getElementById("zar-to-use");
    if (!zarInputElement) {
      console.error("ZAR input element not found");
      this.showPointsStatus("Error: Discount amount input not found", "error");
      return;
    }

    const zarAmount = parseFloat(zarInputElement.value);
    const pointsRate = parseFloat(this.pointsRate);

    if (!zarAmount || zarAmount <= 0) {
      this.showPointsStatus(
        "Please enter a valid discount amount in ZAR.",
        "error"
      );
      return;
    }

    // Calculate points needed for this ZAR amount
    const pointsToUse = Math.ceil(zarAmount / pointsRate);
    const maxAvailableZar = this.totalPoints * pointsRate;

    if (zarAmount > maxAvailableZar) {
      this.showPointsStatus(
        `You can only discount up to R${maxAvailableZar.toFixed(
          2
        )} (${this.totalPoints.toLocaleString()} points)`,
        "error"
      );
      return;
    }

    // Recalculate actual discount amount based on points used (to avoid rounding issues)
    const discountAmount = pointsToUse * pointsRate;
    const remainingPoints = this.totalPoints - pointsToUse;

    // Debug: log discount calculation details in console
    try {
      console.groupCollapsed("[Voyager] Discount Apply Debug");
      console.log("Session ID:", localStorage.getItem("voyager_session_id"));
      console.log(
        "Member Number:",
        localStorage.getItem("voyager_member_number")
      );
      console.log("Total Points:", this.totalPoints);
      console.log("ZAR Amount Entered:", zarAmount.toFixed(2));
      console.log("Points To Use:", pointsToUse);
      console.log("Points Rate:", pointsRate);
      console.log("Discount Amount (ZAR):", discountAmount.toFixed(2));
      console.log("Remaining Points:", remainingPoints);
      console.groupEnd();
    } catch (_) {}

    // Store points usage data
    localStorage.setItem("voyager_points_used", pointsToUse.toString());
    localStorage.setItem("voyager_points_value", discountAmount.toString());
    localStorage.setItem("voyager_points_rate", pointsRate.toString());
    localStorage.setItem(
      "voyager_remaining_points",
      remainingPoints.toString()
    );

    // Reduce mock balance on backend (for testing) before adding cart attributes
    try {
      const sessionId = localStorage.getItem("voyager_session_id");
      if (sessionId) {
        const applyResponse = await fetch(`${this.apiUrl}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, pointsUsed: pointsToUse }),
        });
        if (applyResponse.ok) {
          const applyData = await applyResponse.json();
          if (applyData && typeof applyData.remainingPoints === "number") {
            this.totalPoints = applyData.remainingPoints;
          }
        }
      }
    } catch (e) {
      console.warn("Unable to apply points on backend (mock balance):", e);
    }

    // Add cart attributes for Shopify Function
    this.addCartAttributes(pointsToUse, pointsRate);

    // Show success message with details
    // this.showPointsStatus(
    //   `Successfully applied R${discountAmount.toFixed(2)} discount (${pointsToUse.toLocaleString()} points)! ` +
    //   `Remaining: ${remainingPoints.toLocaleString()} points (R${(remainingPoints * pointsRate).toFixed(2)}).`,
    //   'success'
    // );

    // Update points display
    this.displayPoints(this.totalPoints);

    // Update total after miles
    this.updateTotalAfterMiles(discountAmount);

    // Clear the input field
    if (zarInputElement) {
      zarInputElement.value = "";
    }
    const pointsDisplay = document.getElementById("zar-to-points-display");
    if (pointsDisplay) {
      pointsDisplay.textContent = "";
    }

    // Show checkout prompt
    this.showCheckoutPrompt();
  }

  // Store session in cart attributes (called after login)
  async storeSessionInCartAttributes(sessionId, memberNumber) {
    if (!sessionId || !memberNumber) {
      console.log("[Voyager] Cannot store session in cart attributes - missing data", { sessionId: !!sessionId, memberNumber: !!memberNumber });
      return;
    }

    try {
      const response = await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          attributes: {
            voyager_session_id: sessionId,
            voyager_member_number: memberNumber,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("[Voyager] Session stored in cart attributes successfully:", {
          sessionId,
          memberNumber,
          cartAttributes: data.attributes,
        });
      } else {
        console.error("[Voyager] Failed to store session in cart attributes:", response.status);
      }
    } catch (error) {
      console.error("[Voyager] Error storing session in cart attributes:", error);
    }
  }

  addCartAttributes(pointsUsed, pointsRate) {
    // Store Voyager data in cart attributes for Shopify Function integration
    const sessionId = localStorage.getItem("voyager_session_id");
    const memberNumber = localStorage.getItem("voyager_member_number");
    
    // Also ensure cookies are set (in case they weren't set during login)
    if (sessionId) {
      const cookieExpiry = new Date(Date.now() + 3600 * 1000).toUTCString();
      document.cookie = `voyager_session_id=${sessionId}; expires=${cookieExpiry}; path=/; SameSite=Lax`;
      if (memberNumber) {
        document.cookie = `voyager_member_number=${memberNumber}; expires=${cookieExpiry}; path=/; SameSite=Lax`;
      }
    }

    console.log("Adding cart attributes:", {
      pointsUsed,
      pointsRate,
      sessionId,
      memberNumber,
    });

    // Store in localStorage for now (in production, this would call Shopify's cart API)
    localStorage.setItem("voyager_cart_session_id", sessionId);
    localStorage.setItem("voyager_cart_member_number", memberNumber);

    // IMPORTANT: This is where the discount calculation flow breaks!
    // We need to actually call Shopify's cart API to store these attributes
    // so the Shopify Function can read them during checkout.

    try {
      // Call Shopify's cart API to store Voyager attributes
      fetch("/cart/update.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          attributes: {
            voyager_points_used: pointsUsed.toString(),
            voyager_points_rate: pointsRate.toString(),
            voyager_session_id: sessionId,
            voyager_member_number: memberNumber,
          },
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          console.log("[Voyager] Cart attributes updated successfully:", data);
          // Fetch cart to confirm attributes
          return fetch("/cart.js", { headers: { Accept: "application/json" } });
        })
        .then((r) => (r && r.json ? r.json() : null))
        .then((cartState) => {
          if (cartState) {
            console.log(
              "[Voyager] Current cart attributes:",
              cartState.attributes
            );
          }
          // Trigger cart refresh to ensure attributes are available
          // setTimeout(() => window.location.reload(), 300);
        })
        .catch((error) => {
          console.error("Failed to update cart attributes:", error);
          // Fallback: show error message to user
          this.showPointsStatus(
            "Failed to save points to cart. Please try again.",
            "error"
          );
        });
    } catch (error) {
      console.error("Error calling cart API:", error);
      this.showPointsStatus(
        "Failed to save points to cart. Please try again.",
        "error"
      );
    }
  }

  showCheckoutPrompt() {
    // Remove any existing checkout prompt first
    const existingPrompt =
      this.pointsStatusDiv.querySelector(".checkout-prompt");
    if (existingPrompt) {
      existingPrompt.remove();
    }

    const promptDiv = document.createElement("div");
    promptDiv.className = "checkout-prompt";
    const pointsUsed = localStorage.getItem("voyager_points_used") || "0";
    const discountAmount = localStorage.getItem("voyager_points_value") || "0";
    
    promptDiv.innerHTML = `
      <div style="background:rgb(255, 255, 255); border: 1px solid rgb(121, 121, 121); border-radius: 8px; padding: 12px; margin-top: 12px;">
        <p style="margin: 0 0 12px 0; color:rgb(0, 0, 0); font-weight: 500;">
          Voyager Miles Applied Successfully!
        </p>
        <button type="button" id="remove-discount-btn" class="voyager-remove-discount-btn" style="padding: 8px 16px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">
          REMOVE DISCOUNT
        </button>
      </div>
    `;
    
    // Add event listener for remove discount button
    setTimeout(() => {
      const removeBtn = document.getElementById("remove-discount-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => this.handleRemoveDiscount());
      }
    }, 100);

    // Append to pointsStatusDiv, but don't let showPointsStatus clear it
    this.pointsStatusDiv.appendChild(promptDiv);
    this.pointsStatusDiv.style.display = "block";
  }

  async handleLogout() {
    try {
      const sessionId = localStorage.getItem("voyager_session_id");

      if (sessionId) {
        // Call logout API
        await fetch(`${this.apiUrl}/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId }),
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      // Clear all Voyager data
      localStorage.removeItem("voyager_session_id");
      localStorage.removeItem("voyager_member_number");
      localStorage.removeItem("voyager_total_points");
      localStorage.removeItem("voyager_points_rate");
      localStorage.removeItem("voyager_points_used");
      localStorage.removeItem("voyager_points_value");

      this.hidePointsDisplay();
      this.showStatus("Logged out successfully", "success");

      // Reset form
      this.loginForm.reset();
    }
  }

  checkExistingSession() {
    const sessionId = localStorage.getItem("voyager_session_id");
    if (sessionId) {
      // Show the miles section if there's an existing session
      const milesSection = document.getElementById("voyager-miles-section");
      if (milesSection) {
        milesSection.style.display = "block";
      }
      this.showPointsDisplay();
      this.fetchAccountSummary();
      
      // Check if discount is already applied
      this.checkAndShowRemoveDiscountButton();
    }
  }
  
  checkAndShowRemoveDiscountButton() {
    const pointsUsed = localStorage.getItem("voyager_points_used");
    if (pointsUsed && parseInt(pointsUsed) > 0) {
      // Discount is applied, show remove button if not already shown
      const existingPrompt = this.pointsStatusDiv?.querySelector(".checkout-prompt");
      if (!existingPrompt) {
        this.showCheckoutPrompt();
      }
    }
  }
  
  async handleRemoveDiscount() {
    console.log("[Voyager] Removing applied discount...");
    
    try {
      // Clear cart attributes to remove discount
      await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          attributes: {
            voyager_points_used: "",
            voyager_points_rate: "",
            voyager_session_id: "",
            voyager_member_number: "",
            voyager_total_points: "",
            voyager_remaining_points: "",
            voyager_discount_amount: "",
            voyager_points_value: "",
          },
        }),
      });
      
      // Clear localStorage
      localStorage.removeItem("voyager_points_used");
      localStorage.removeItem("voyager_points_value");
      localStorage.removeItem("voyager_remaining_points");
      
      // Update UI
      this.updateTotalAfterMiles(0);
      this.clearPointsStatus();
      
      // Remove checkout prompt
      const existingPrompt = this.pointsStatusDiv?.querySelector(".checkout-prompt");
      if (existingPrompt) {
        existingPrompt.remove();
      }
      
      // Refresh points display to show original balance
      const sessionId = localStorage.getItem("voyager_session_id");
      if (sessionId) {
        await this.fetchAccountSummary();
      }
      
      this.showPointsStatus("Discount removed successfully", "success");
      console.log("[Voyager] Discount removed successfully");
      
    } catch (error) {
      console.error("[Voyager] Error removing discount:", error);
      this.showPointsStatus("Failed to remove discount. Please try again.", "error");
    }
  }

  showPointsDisplay() {
    if (this.loginForm) this.loginForm.style.display = "none";
    if (this.pointsDisplay) this.pointsDisplay.style.display = "block";
  }

  hidePointsDisplay() {
    if (this.loginForm) this.loginForm.style.display = "block";
    if (this.pointsDisplay) this.pointsDisplay.style.display = "none";
  }

  toggleLoginForm() {
    const milesSection = document.getElementById("voyager-miles-section");
    if (milesSection) {
      const isVisible = milesSection.style.display !== "none";
      milesSection.style.display = isVisible ? "none" : "block";

      // If showing, check if user is already logged in
      if (!isVisible) {
        const sessionId = localStorage.getItem("voyager_session_id");
        
        if (sessionId) {
          // User is logged in, show points display
          this.showPointsDisplay();
          // Refresh account summary to ensure data is up to date
          this.fetchAccountSummary();
        } else {
          // User is not logged in, show login form
          if (this.loginForm) this.loginForm.style.display = "block";
          if (this.pointsDisplay) this.pointsDisplay.style.display = "none";
          // Reset form
          if (this.loginForm) {
            this.loginForm.reset();
            this.hideStatus();
          }
        }
      }
    }
  }

  showStatus(message, type = "info") {
    if (!this.statusDiv) return;

    this.statusDiv.textContent = message;
    this.statusDiv.className = `voyager-status voyager-status-${type}`;
    this.statusDiv.style.display = "block";

    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.statusDiv.style.display = "none";
    }, 5000);
  }

  hideStatus() {
    if (this.statusDiv) {
      this.statusDiv.style.display = "none";
    }
  }

  showPointsStatus(message, type = "info") {
    if (!this.pointsStatusDiv) return;

    // Find or create a status message element (separate from checkout prompt)
    let statusMessage = this.pointsStatusDiv.querySelector(".status-message");
    if (!statusMessage) {
      statusMessage = document.createElement("div");
      statusMessage.className = "status-message";
      this.pointsStatusDiv.insertBefore(
        statusMessage,
        this.pointsStatusDiv.firstChild
      );
    }

    statusMessage.textContent = message;
    statusMessage.className = `status-message points-status points-status-${type}`;
    statusMessage.style.display = "block";
    this.pointsStatusDiv.style.display = "block";

    // Auto-hide status message after 5 seconds (but keep checkout prompt visible)
    setTimeout(() => {
      if (statusMessage && statusMessage.parentNode) {
        statusMessage.style.display = "none";
        // Only hide the entire div if there's no checkout prompt
        const checkoutPrompt =
          this.pointsStatusDiv.querySelector(".checkout-prompt");
        if (!checkoutPrompt || checkoutPrompt.style.display === "none") {
          this.pointsStatusDiv.style.display = "none";
        }
      }
    }, 5000);
  }

  clearPointsStatus() {
    if (this.pointsStatusDiv) {
      // Only clear the status message, not the checkout prompt
      const statusMessage =
        this.pointsStatusDiv.querySelector(".status-message");
      if (statusMessage) {
        statusMessage.style.display = "none";
      }
      // Only hide the entire div if there's no checkout prompt
      const checkoutPrompt =
        this.pointsStatusDiv.querySelector(".checkout-prompt");
      if (!checkoutPrompt || checkoutPrompt.style.display === "none") {
        this.pointsStatusDiv.style.display = "none";
      }
    }
  }

  setLoading(loading) {
    const loginBtn = document.getElementById("voyager-login-btn");
    if (loginBtn) {
      loginBtn.disabled = loading;
      loginBtn.textContent = loading ? "Logging in..." : "Login & Check Points";
    }

    if (loading) {
      this.block.classList.add("voyager-loading");
    } else {
      this.block.classList.remove("voyager-loading");
    }
  }

  moveAboveCheckoutButton() {
    if (!this.block) {
      console.log("[Voyager] Block not found, cannot move");
      return;
    }

    // Wait for block to be in the DOM
    if (!this.block.parentElement) {
      console.log("[Voyager] Block not in DOM yet, will retry...");
      setTimeout(() => this.moveAboveCheckoutButton(), 200);
      return;
    }

    console.log("[Voyager] Attempting to move block above checkout button...");
    console.log("[Voyager] Current block:", this.block);
    console.log("[Voyager] Current block parent:", this.block.parentElement);

    // More comprehensive checkout button selectors
    const checkoutSelectors = [
      'button[name="checkout"]',
      '[name="checkout"]',
      'a[href*="/checkout"]',
      ".cart__checkout",
      ".cart__submit",
      ".checkout-button",
      'form[action="/cart"] button[type="submit"]',
      'form[action*="/cart"] button[type="submit"]',
      '.cart-drawer__footer button[type="submit"]',
      '.cart__footer button[type="submit"]',
      'button[type="submit"][form="cart"]',
      "[data-checkout-button]",
      ".btn--checkout",
      "#checkout",
    ];

    const tryMove = () => {
      let checkoutButton = null;
      let checkoutContainer = null;

      // Strategy 1: Look for buttons near subtotal/cart totals sections
      const subtotalSections = document.querySelectorAll(
        '[class*="subtotal"], [class*="cart-total"], [class*="cart-summary"], [id*="subtotal"], [id*="cart-total"]'
      );
      for (const section of subtotalSections) {
        const buttons = section.querySelectorAll(
          'button, a[href*="/checkout"]'
        );
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || "";
          if (
            text.includes("check out") ||
            text.includes("checkout") ||
            btn.getAttribute("name") === "checkout" ||
            btn.href?.includes("/checkout")
          ) {
            checkoutButton = btn;
            console.log(
              "[Voyager] Found checkout button near subtotal section:",
              btn
            );
            break;
          }
        }
        if (checkoutButton) break;
      }

      // Strategy 2: Try to find the checkout button by text content
      if (!checkoutButton) {
        const allButtons = document.querySelectorAll(
          'button, a[href*="/checkout"]'
        );
        for (const btn of allButtons) {
          const text = btn.textContent?.toLowerCase() || "";
          if (
            text.includes("check out") ||
            text.includes("checkout") ||
            btn.getAttribute("name") === "checkout" ||
            btn.href?.includes("/checkout")
          ) {
            checkoutButton = btn;
            console.log(
              "[Voyager] Found checkout button by text/content:",
              btn
            );
            break;
          }
        }
      }

      // Strategy 3: Try selectors
      if (!checkoutButton) {
        for (const selector of checkoutSelectors) {
          try {
            checkoutButton = document.querySelector(selector);
            if (checkoutButton) {
              console.log(
                "[Voyager] Found checkout button with selector:",
                selector
              );
              break;
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }
      }

      if (!checkoutButton) {
        console.log("[Voyager] Checkout button not found yet");
        return false; // Not found yet
      }

      console.log("[Voyager] Checkout button found:", checkoutButton);
      console.log(
        "[Voyager] Checkout button parent:",
        checkoutButton.parentElement
      );

      // Check if block is in the DOM
      if (!this.block.parentElement) {
        console.log("[Voyager] ⚠️ Block is not in the DOM yet, cannot move");
        return false;
      }

      // The button's direct parent (likely .cart__ctas with flexbox row layout)
      const buttonParent = checkoutButton.parentElement;

      if (!buttonParent) {
        console.log("[Voyager] ⚠️ Checkout button has no parent");
        return false;
      }

      console.log("[Voyager] Button parent:", buttonParent);
      console.log("[Voyager] Button parent tag:", buttonParent.tagName);
      console.log("[Voyager] Button parent class:", buttonParent.className);

      // Find the parent of buttonParent to move the block above the entire checkout section
      // This way the block will appear above the checkout button container, not beside it
      const targetContainer = buttonParent.parentElement;

      if (!targetContainer) {
        console.log(
          "[Voyager] ⚠️ Button parent has no parent, using button parent instead"
        );
        // Fallback: use button parent and force full width with CSS
        // Remove block from current position if different
        if (
          this.block.parentElement &&
          this.block.parentElement !== buttonParent
        ) {
          this.block.parentElement.removeChild(this.block);
        }

        // Insert before button
        try {
          buttonParent.insertBefore(this.block, checkoutButton);
          // Force full width to appear above
          this.block.style.width = "100%";
          this.block.style.flexBasis = "100%";
          console.log(
            "[Voyager] ✅ Moved block to button parent with full width"
          );
          return true;
        } catch (error) {
          console.error("[Voyager] ❌ Error:", error);
          return false;
        }
      }

      console.log(
        "[Voyager] Target container (parent of button parent):",
        targetContainer
      );
      console.log("[Voyager] Target container tag:", targetContainer.tagName);
      console.log(
        "[Voyager] Target container class:",
        targetContainer.className
      );

      // Check if already in correct position (block is before buttonParent in targetContainer)
      if (targetContainer.contains(this.block)) {
        const children = Array.from(targetContainer.children);
        const blockIndex = children.indexOf(this.block);
        const buttonParentIndex = children.indexOf(buttonParent);

        if (
          blockIndex !== -1 &&
          buttonParentIndex !== -1 &&
          blockIndex < buttonParentIndex
        ) {
          console.log(
            "[Voyager] ✅ Block already in correct position (block index:",
            blockIndex,
            ", button parent index:",
            buttonParentIndex,
            ")"
          );
          return true;
        }
      }

      // Remove block from current position if it's in a different parent
      if (
        this.block.parentElement &&
        this.block.parentElement !== targetContainer
      ) {
        this.block.parentElement.removeChild(this.block);
        console.log("[Voyager] Removed block from old parent");
      }

      // Insert the block before the buttonParent container
      // This will place the block above the entire checkout section
      try {
        targetContainer.insertBefore(this.block, buttonParent);
        console.log(
          "[Voyager] ✅ Successfully moved Voyager block above checkout button container"
        );
        return true;
      } catch (error) {
        console.error("[Voyager] ❌ Error moving block:", error);
        console.error("[Voyager] Error details:", {
          blockParent: this.block.parentElement,
          targetContainer: targetContainer,
          buttonParentIsChild: targetContainer.contains(buttonParent),
          blockIsChild: targetContainer.contains(this.block),
        });
        return false;
      }
    };

    // Try immediately
    if (tryMove()) {
      return;
    }

    // If not found, wait a bit and try again (for dynamic content)
    setTimeout(() => {
      if (!tryMove()) {
        console.log("[Voyager] ⚠️ Checkout button not found after retry");
        // Try one more time with a longer delay
        setTimeout(() => {
          if (!tryMove()) {
            console.log(
              "[Voyager] ⚠️ Checkout button not found after final retry, keeping default position"
            );
          }
        }, 1000);
      }
    }, 500);

    // Also observe DOM changes for cart drawers that load dynamically
    const observer = new MutationObserver(() => {
      if (tryMove()) {
        observer.disconnect();
        console.log("[Voyager] ✅ Moved via MutationObserver");
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Disconnect observer after 10 seconds to avoid memory leaks
    setTimeout(() => {
      observer.disconnect();
      console.log("[Voyager] MutationObserver disconnected");
    }, 10000);
  }

  moveAboveSubtotal() {
    if (!this.block) {
      console.log("[Voyager] Block not found, cannot move");
      return;
    }

    // Wait for block to be in the DOM
    if (!this.block.parentElement) {
      console.log("[Voyager] Block not in DOM yet, will retry...");
      setTimeout(() => this.moveAboveSubtotal(), 200);
      return;
    }

    console.log("[Voyager] Attempting to move block above subtotal (as sibling, not inside)...");

    const tryMove = () => {
      // Common selectors for subtotal sections - these should be the containers, not inner elements
      const subtotalSelectors = [
        '.cart__subtotal',
        '.cart-subtotal',
        '.cart__total',
        '.cart-total',
        '.cart-summary',
        '.cart__summary',
        '.cart-totals',
        '.cart__totals',
        '.totals', // Common Shopify class
        '[class*="subtotal"]',
        '[id*="subtotal"]',
        '[id*="cart-total"]',
        '[class*="cart-total"]',
        '.cart__footer',
        '.cart-footer',
        '.cart-drawer__footer',
        '.cart-drawer__summary',
        'form[action*="/cart"] .cart__footer',
        'form[action*="/cart"] .cart__summary',
      ];

      let subtotalSection = null;

      // Try to find subtotal section
      for (const selector of subtotalSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            // Check if this element contains subtotal-related text or price
            const text = element.textContent?.toLowerCase() || '';
            const hasSubtotal = text.includes('subtotal') || 
                              (text.includes('total') && !text.includes('voyager')) || 
                              element.querySelector('[class*="price"]') ||
                              element.querySelector('[class*="money"]') ||
                              element.querySelector('[data-cart-total]');
            
            // Make sure it's not our block or inside our block
            if (hasSubtotal && element.offsetParent !== null && 
                !element.contains(this.block) && 
                element !== this.block) {
              subtotalSection = element;
              console.log("[Voyager] Found subtotal section:", selector, element);
              break;
            }
          }
          if (subtotalSection) break;
        } catch (e) {
          console.log("[Voyager] Selector failed:", selector, e);
        }
      }

      if (!subtotalSection) {
        console.log("[Voyager] Subtotal section not found");
        return false;
      }

      // Get the parent of the subtotal section - this is where we want to insert
      const subtotalParent = subtotalSection.parentElement;
      
      if (!subtotalParent) {
        console.log("[Voyager] Subtotal section has no parent");
        return false;
      }

      // Make sure we're not already inside the subtotal section
      if (subtotalSection.contains(this.block)) {
        console.log("[Voyager] ⚠️ Block is inside subtotal section, removing it first");
        this.block.parentElement.removeChild(this.block);
      }

      // Check if already in correct position (as sibling, before subtotal)
      if (subtotalParent.contains(this.block)) {
        const children = Array.from(subtotalParent.children);
        const blockIndex = children.indexOf(this.block);
        const subtotalIndex = children.indexOf(subtotalSection);

        if (blockIndex !== -1 && subtotalIndex !== -1 && blockIndex < subtotalIndex) {
          console.log("[Voyager] ✅ Block already above subtotal as sibling");
          return true;
        }
      }

      // Remove block from current position if it's in a different parent
      if (this.block.parentElement && this.block.parentElement !== subtotalParent) {
        this.block.parentElement.removeChild(this.block);
        console.log("[Voyager] Removed block from old parent");
      }

      // Insert the block as a sibling BEFORE the subtotal section (not inside it)
      try {
        subtotalParent.insertBefore(this.block, subtotalSection);
        console.log("[Voyager] ✅ Successfully moved Voyager block above subtotal as sibling");
        return true;
      } catch (error) {
        console.error("[Voyager] ❌ Error moving block:", error);
        return false;
      }
    };

    // Try immediately
    if (tryMove()) {
      return;
    }

    // If not found, wait a bit and try again (for dynamic content)
    setTimeout(() => {
      if (!tryMove()) {
        console.log("[Voyager] ⚠️ Subtotal section not found after retry");
        // Try one more time with a longer delay
        setTimeout(() => {
          if (!tryMove()) {
            console.log("[Voyager] ⚠️ Subtotal section not found after final retry, keeping default position");
          }
        }, 1000);
      }
    }, 500);

    // Also observe DOM changes for cart drawers that load dynamically
    const observer = new MutationObserver(() => {
      if (tryMove()) {
        observer.disconnect();
        console.log("[Voyager] ✅ Moved above subtotal via MutationObserver");
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Disconnect observer after 10 seconds to avoid memory leaks
    setTimeout(() => {
      observer.disconnect();
      console.log("[Voyager] MutationObserver disconnected");
    }, 10000);
  }
}

// Initialize when DOM is ready
function initializeVoyager() {
  // Wait a bit to ensure all elements are loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => new VoyagerMilesCart(), 100);
    });
  } else {
    // DOM already loaded
    setTimeout(() => new VoyagerMilesCart(), 100);
  }
}

// Also try on window load (for dynamic content)
window.addEventListener("load", () => {
  // Re-initialize or re-run move function if needed
  const existingInstance = window.voyagerMilesCartInstance;
  if (existingInstance && existingInstance.moveAboveCheckoutButton) {
    setTimeout(() => {
      existingInstance.moveAboveSubtotal();
    }, 500);
  }
});

// Initialize
initializeVoyager();

// Export for testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = VoyagerMilesCart;
}
