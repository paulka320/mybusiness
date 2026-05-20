<?php
include "db.php";
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cart | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script>
</head>
<body>
<?php include 'header.php'; ?>
<main class="section cart-section">
    <div class="section-heading">
        <h2>Your Shopping Cart</h2>
    </div>
    <div id="cart-items" class="cart-items"></div>
    <div class="cart-buttons">
        <?php if (isset($_SESSION['user_id'])) { ?>
            <a class="button checkout-link" href="checkout.php">Proceed to Checkout</a>
        <?php } else { ?>
            <a class="button checkout-link" href="login.php?return=checkout.php">Login to Checkout</a>
        <?php } ?>
        <button id="clear-cart" type="button">Clear Cart</button>
    </div>
</main>
</body>
</html>
