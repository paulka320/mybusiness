<?php
include "db.php";

if (!isset($_SESSION['user_id']) || !isset($_SESSION['is_admin']) || $_SESSION['is_admin'] != 1) {
    header('Location: admin_login.php');
    exit;
}

$products = $conn->query("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.id DESC");

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['update_quantity'])) {
        $productId = intval($_POST['product_id']);
        $newQuantity = intval($_POST['quantity']);
        $approved = $newQuantity > 0 ? 1 : 0;

        $stmt = $conn->prepare('UPDATE products SET quantity = ?, approved = ? WHERE id = ?');
        $stmt->bind_param('iii', $newQuantity, $approved, $productId);
        $stmt->execute();
        $stmt->close();
    }

    if (isset($_POST['delete_product'])) {
        $productId = intval($_POST['product_id']);
        $stmt = $conn->prepare('DELETE FROM products WHERE id = ?');
        $stmt->bind_param('i', $productId);
        $stmt->execute();
        $stmt->close();
    }

    header('Location: admin_dashboard.php');
    exit;
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'header.php'; ?>
<main class="section">
    <div class="section-heading">
        <h2>Admin Dashboard</h2>
        <p>Manage product quantities.</p>
    </div>

    <div class="products-grid">
        <?php while ($product = $products->fetch_assoc()) { ?>
            <article class="product-card">
                <div class="product-image">
                    <img src="uploads/<?php echo htmlspecialchars($product['image']); ?>" alt="<?php echo htmlspecialchars($product['title']); ?>">
                </div>
                <div class="product-body">
                    <p class="product-category"><?php echo htmlspecialchars($product['category_name'] ?: 'General'); ?></p>
                    <h3><?php echo htmlspecialchars($product['title']); ?></h3>
                    <p class="product-description"><?php echo htmlspecialchars(substr($product['description'], 0, 60)); ?>...</p>
                    <div class="product-footer">
                        <span class="price">UGX <?php echo number_format($product['price']); ?></span>
                        <span>Qty: <?php echo $product['quantity']; ?></span>
                    </div>
                    <form method="POST" action="admin_dashboard.php" style="margin-top: 10px; display: flex; gap: 8px; align-items: center;">
                        <input type="hidden" name="product_id" value="<?php echo $product['id']; ?>">
                        <input type="number" name="quantity" min="0" value="<?php echo $product['quantity']; ?>" style="width: 80px; padding: 8px;">
                        <button type="submit" name="update_quantity" style="padding: 8px 12px; font-size: 12px; background: #ff5e62; color: white; border: none; border-radius: 10px;">Save</button>
                        <button type="submit" name="delete_product" style="padding: 8px 12px; font-size: 12px; background: #666; color: white; border: none; border-radius: 10px;">Delete</button>
                    </form>
                </div>
            </article>
        <?php } ?>
    </div>
</main>
</body>
</html>