<?php
if (!session_id()) {
    session_start();
}
$userName = $_SESSION['user_name'] ?? null;
?>
<header class="site-header">
    <div class="top-bar">
        <a class="logo" href="index.php">EasyMarket</a>
        <nav class="main-nav">
            <a href="index.php">Home</a>
            <a href="upload.php">Sell</a>
            <a href="cart.php">Cart <span id="cart-count">0</span></a>
            <?php if ($userName) { ?>
                <a href="orders.php">My Orders</a>
                <?php if (isset($_SESSION['is_admin']) && $_SESSION['is_admin'] == 1) { ?>
                    <a href="admin_dashboard.php">Admin</a>
                <?php } ?>
                <a href="logout.php">Logout</a>
                <span class="nav-user">Hi, <?php echo htmlspecialchars($userName); ?></span>
            <?php } else { ?>
                <a href="login.php">Login</a>
                <a href="register.php">Register</a>
            <?php } ?>
        </nav>
    </div>
</header>