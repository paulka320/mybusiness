<?php
include "db.php";

if (empty($_SESSION['user_id'])) {
    header('Location: login.php?return=checkout.php');
    exit;
}

$errors = [];
$success = '';
$orderId = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $cartJson = trim($_POST['cart_data'] ?? '');
    $address = trim($_POST['address'] ?? '');
    $phone = trim($_POST['phone'] ?? '');
    $paymentReference = trim($_POST['payment_reference'] ?? '');

    if ($cartJson === '') {
        $errors[] = 'Your cart is empty. Add items before checking out.';
    }
    if ($address === '') {
        $errors[] = 'Delivery address is required.';
    }
    if ($phone === '') {
        $errors[] = 'A phone number is required.';
    }

    $cartItems = json_decode($cartJson, true);
    if (!is_array($cartItems) || count($cartItems) === 0) {
        $errors[] = 'Invalid cart data. Please refresh the page and try again.';
    }

    if (empty($errors)) {
        $total = 0;
        $validatedItems = [];

        $productStmt = $conn->prepare('SELECT title, price, quantity FROM products WHERE id = ? AND approved = 1');
        foreach ($cartItems as $item) {
            $productId = intval($item['id'] ?? 0);
            $quantity = intval($item['quantity'] ?? 0);

            if ($productId <= 0 || $quantity <= 0) {
                $errors[] = 'Cart contains invalid product quantities or product references.';
                break;
            }

            $productStmt->bind_param('i', $productId);
            $productStmt->execute();
            $productResult = $productStmt->get_result();
            $productRow = $productResult->fetch_assoc();

            if (!$productRow) {
                $errors[] = 'One of the products in your cart is no longer available.';
                break;
            }
            if ($quantity > intval($productRow['quantity'])) {
                $errors[] = 'Only ' . intval($productRow['quantity']) . ' unit(s) of "' . htmlspecialchars($productRow['title']) . '" are available.';
                break;
            }

            $price = floatval($productRow['price']);
            $total += $price * $quantity;
            $validatedItems[] = [
                'product_id' => $productId,
                'title' => $productRow['title'],
                'price' => $price,
                'quantity' => $quantity,
                'image' => trim($item['image'] ?? '')
            ];
        }
        $productStmt->close();
    }

    if (empty($errors)) {
        $status = 'Pending';
        $stmt = $conn->prepare('INSERT INTO orders(user_id, total, status, address, phone, payment_reference) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->bind_param('idssss', $_SESSION['user_id'], $total, $status, $address, $phone, $paymentReference);
        $stmt->execute();
        $orderId = $stmt->insert_id;
        $stmt->close();

        $itemStmt = $conn->prepare('INSERT INTO order_items(order_id, product_id, title, price, quantity, image) VALUES (?, ?, ?, ?, ?, ?)');
        $updateStmt = $conn->prepare('UPDATE products SET quantity = GREATEST(quantity - ?, 0), approved = IF(quantity - ? <= 0, 0, approved) WHERE id = ?');

        foreach ($validatedItems as $item) {
            $itemStmt->bind_param('iidsis', $orderId, $item['product_id'], $item['title'], $item['price'], $item['quantity'], $item['image']);
            $itemStmt->execute();

            $updateStmt->bind_param('iii', $item['quantity'], $item['quantity'], $item['product_id']);
            $updateStmt->execute();
        }

        $itemStmt->close();
        $updateStmt->close();

        $success = 'Your order has been placed successfully. Order #' . $orderId . ' is now pending.';
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Checkout | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script>
</head>
<body>
<?php include 'header.php'; ?>
<main class="section upload-section">
    <div class="section-heading">
        <h2>Checkout</h2>
        <p>Confirm your order details and place your purchase.</p>
    </div>

    <?php if (!empty($success)) { ?>
        <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
        <script>window.orderPlaced = true;</script>
        <p><a href="index.php">Continue shopping</a> or view your <a href="orders.php">orders</a>.</p>
    <?php } else { ?>
        <?php if (!empty($errors)) { ?>
            <div class="alert alert-error">
                <ul>
                    <?php foreach ($errors as $error) { ?>
                        <li><?php echo htmlspecialchars($error); ?></li>
                    <?php } ?>
                </ul>
            </div>
        <?php } ?>

        <div id="checkout-items" class="cart-items"></div>

        <form id="checkout-form" class="product-form" method="POST" action="checkout.php">
            <input type="hidden" id="cart_data" name="cart_data" value="">

            <label>Delivery Address</label>
            <textarea name="address" required><?php echo htmlspecialchars($_POST['address'] ?? ''); ?></textarea>

            <label>Phone Number</label>
            <input type="text" name="phone" value="<?php echo htmlspecialchars($_POST['phone'] ?? ''); ?>" required>

            <label>Payment Reference</label>
            <input type="text" name="payment_reference" value="<?php echo htmlspecialchars($_POST['payment_reference'] ?? ''); ?>" placeholder="Enter payment reference or mobile money code">

            <button id="checkout-submit" type="submit">Place Order</button>
        </form>
    <?php } ?>
</main>
</body>
</html>