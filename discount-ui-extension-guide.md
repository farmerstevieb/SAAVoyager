# Creating Discount UI Extension

## For `purchase.product-discount.run` (test-product-discount)

### Option 1: Add UI Paths (Simple)

Since your Voyager discount doesn't need configuration, you can add minimal UI paths:

1. **Update `shopify.extension.toml`:**

```toml
[extensions.ui.paths]
create = "/discounts/create"
details = "/discounts/details"
```

2. **Create routes in your main app** (not in extension):
   - These routes need to exist in your Shopify app
   - They render a simple UI that calls `ui.applyChanges()` to save the discount

### Option 2: Create Admin UI Extension (Recommended)

1. **Generate the extension:**

```bash
shopify app generate extension --type=admin_action --name=voyager-discount-ui
```

2. **Update the extension to target discount:**

```toml
[[extensions.targeting]]
target = "admin.discount.render"
```

3. **Create the UI component** that renders when merchants configure the discount

## For `cart.lines.discounts.generate.run` (voyager-miles-discount)

This requires an **Admin UI Extension** with `admin.discount.render` target:

1. **Generate Admin UI Extension:**

```bash
shopify app generate extension --type=admin_action --name=voyager-discount-ui
```

2. **Update `shopify.extension.toml`:**

```toml
[[extensions]]
name = "voyager-discount-ui"
type = "ui_extension"

[[extensions.targeting]]
target = "admin.discount.render"
```

3. **Create the UI** that allows merchants to configure the discount

## Recommendation

Since your Voyager discount:

- ✅ Doesn't need merchant configuration
- ✅ Reads everything from cart attributes
- ✅ Works automatically

**You don't really need a UI extension!** Just create the discount via API once, and it will work automatically.

However, if you want merchants to be able to create/manage discounts through Admin UI, you can create a minimal UI extension.
