<?php
include "db.php";

$id = intval($_GET['id'] ?? 0);
$product = $conn->query("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id=$id AND p.approved=1 AND p.quantity > 0")->fetch_assoc();

if (!$product) {
    header('Location: index.php');
    exit;
}

$similar = $conn->query("SELECT * FROM products WHERE category_id=" . intval($product['category_id']) . " AND id != $id AND approved=1 ORDER BY id DESC LIMIT 4");
$imagesResult = $conn->query("SELECT * FROM product_images WHERE product_id=$id ORDER BY is_main DESC, id ASC");
$images = [];
if ($imagesResult) {
    while ($row = $imagesResult->fetch_assoc()) {
        $images[] = $row;
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($product['title']); ?> | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script>
</head>
<body>
<?php include 'header.php'; ?>
<main class="section product-detail-section">
    <div class="section-heading">
        <div>
            <h2><?php echo htmlspecialchars($product['title']); ?></h2>
            <p><?php echo htmlspecialchars($product['category_name'] ?: 'General'); ?> · Posted in Uganda</p>
        </div>
    </div>

    <div class="product-detail-grid">
        <div class="product-detail-image">
            <div class="image-carousel">
                <?php if (count($images) > 0) { ?>
                    <?php foreach ($images as $img) { ?>
                        <img src="uploads/<?php echo htmlspecialchars($img['image_path']); ?>" alt="<?php echo htmlspecialchars($product['title']); ?>" class="carousel-image">
                    <?php } ?>
                <?php } else { ?>
                    <img src="uploads/<?php echo htmlspecialchars($product['image']); ?>" alt="<?php echo htmlspecialchars($product['title']); ?>" class="carousel-image">
                <?php } ?>
            </div>
            <?php if (count($images) > 1) { ?>
                <button class="carousel-prev">&lt;</button>
                <button class="carousel-next">&gt;</button>
            <?php } ?>

            <?php if (count($images) > 1) { ?>
                <div class="carousel-indicators">
                    <?php for ($i = 0; $i < count($images); $i++) { ?>
                        <button class="indicator<?php echo $i === 0 ? ' active' : ''; ?>" data-index="<?php echo $i; ?>"></button>
                    <?php } ?>
                </div>
                <p class="hint">Use arrows to view the product from all angles.</p>
            <?php } ?>
        </div>
        <div class="product-detail-info">
            <p class="product-detail-price">UGX <?php echo number_format($product['price']); ?></p>
            <form class="add-to-cart-form" method="POST" action="">
                <label>Quantity</label>
                <input type="number" name="quantity" min="1" max="<?php echo $product['quantity']; ?>" value="1" required>
                <button type="submit" class="cart-action" data-id="<?php echo $product['id']; ?>" data-title="<?php echo htmlspecialchars($product['title']); ?>" data-price="<?php echo $product['price']; ?>" data-image="<?php echo htmlspecialchars($product['image']); ?>">Add to Cart</button>
            </form>

            <div class="product-detail-meta">
                <p><strong>Location:</strong> <?php echo htmlspecialchars($product['location']); ?></p>
                <p><strong>Seller Phone:</strong> <?php echo htmlspecialchars($product['phone']); ?></p>
                <p><strong>Payment Code:</strong> <?php echo htmlspecialchars($product['payment_code']); ?></p>
                <p><strong>Available Quantity:</strong> <?php echo $product['quantity']; ?></p>
            </div>

            <div class="product-detail-description">
                <h3>Product Description</h3>
                <p><?php echo nl2br(htmlspecialchars($product['description'])); ?></p>
            </div>
        </div>
    </div>

    <?php if ($similar && $similar->num_rows > 0) { ?>
        <section class="section">
            <div class="section-heading">
                <h2>More from this category</h2>
            </div>
            <div class="products-grid">
                <?php while ($row = $similar->fetch_assoc()) { ?>
                    <article class="product-card">
                        <a class="product-link" href="product.php?id=<?php echo $row['id']; ?>">
                            <div class="product-image">
                                <img src="uploads/<?php echo htmlspecialchars($row['image']); ?>" alt="<?php echo htmlspecialchars($row['title']); ?>">
                            </div>
                            <div class="product-body">
                                <h3><?php echo htmlspecialchars($row['title']); ?></h3>
                                <div class="product-footer">
                                    <span class="price">UGX <?php echo number_format($row['price']); ?></span>
                                </div>
                            </div>
                        </a>
                    </article>
                <?php } ?>
            </div>
        </section>
    <?php } ?>
</main>
</body>
</html>
