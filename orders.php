<?php
include "db.php";

if (empty($_SESSION['user_id'])) {
    header('Location: login.php?return=orders.php');
    exit;
}

$userId = $_SESSION['user_id'];

$orderQuery = $conn->prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC');
$orderQuery->bind_param('i', $userId);
$orderQuery->execute();
$orders = $orderQuery->get_result();
$orderQuery->close();
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Orders | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'header.php'; ?>
<main class="section orders-section">
    <div class="section-heading">
        <h2>My Orders</h2>
        <p>Review your recent purchases and order details.</p>
    </div>

    <?php if ($orders && $orders->num_rows > 0) { ?>
        <?php while ($order = $orders->fetch_assoc()) {
            $itemStmt = $conn->prepare('SELECT * FROM order_items WHERE order_id = ?');
            $itemStmt->bind_param('i', $order['id']);
            $itemStmt->execute();
            $items = $itemStmt->get_result();
            $itemStmt->close();
        ?>
            <section class="order-card">
                <div class="order-card-header">
                    <div>
                        <h3>Order #<?php echo $order['id']; ?></h3>
                        <p>Status: <?php echo htmlspecialchars($order['status']); ?></p>
                    </div>
                    <div>
                        <span class="order-total">UGX <?php echo number_format($order['total'], 0); ?></span>
                        <p><?php echo date('M d, Y H:i', strtotime($order['created_at'])); ?></p>
                    </div>
                </div>
                <div class="order-delivery">
                    <p><strong>Delivery address:</strong> <?php echo htmlspecialchars($order['address']); ?></p>
                    <p><strong>Phone:</strong> <?php echo htmlspecialchars($order['phone']); ?></p>
                    <?php if ($order['payment_reference']) { ?><p><strong>Payment ref:</strong> <?php echo htmlspecialchars($order['payment_reference']); ?></p><?php } ?>
                </div>
                <div class="order-items">
                    <?php while ($item = $items->fetch_assoc()) { ?>
                        <div class="order-item">
                            <img src="uploads/<?php echo htmlspecialchars($item['image']); ?>" alt="<?php echo htmlspecialchars($item['title']); ?>">
                            <div>
                                <h4><?php echo htmlspecialchars($item['title']); ?></h4>
                                <p>Quantity: <?php echo $item['quantity']; ?></p>
                                <p>Price: UGX <?php echo number_format($item['price'], 0); ?></p>
                            </div>
                        </div>
                    <?php } ?>
                </div>
            </section>
        <?php } ?>
    <?php } else { ?>
        <div class="empty-state">
            <h3>No orders found yet.</h3>
            <p>Place an order from the marketplace and it will appear here.</p>
        </div>
    <?php } ?>
</main>
</body>
</html>