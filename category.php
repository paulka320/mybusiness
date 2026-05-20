<?php
include "db.php";

$search = trim($_GET['search'] ?? '');
$sort = $_GET['sort'] ?? 'newest';
$id = intval($_GET['id'] ?? 0);
$categories = $conn->query("SELECT * FROM categories ORDER BY name");
$category = $conn->query("SELECT * FROM categories WHERE id=$id")->fetch_assoc();

if (!$category) {
    header('Location: index.php');
    exit;
}

$where = "p.category_id = $id AND p.approved = 1 AND p.quantity > 0";
if ($search !== '') {
    $safeSearch = $conn->real_escape_string($search);
    $where .= " AND (p.title LIKE '%$safeSearch%' OR p.description LIKE '%$safeSearch%' OR p.location LIKE '%$safeSearch%')";
}

$sortBy = 'p.id DESC';
switch ($sort) {
    case 'price_asc':
        $sortBy = 'p.price ASC';
        break;
    case 'price_desc':
        $sortBy = 'p.price DESC';
        break;
    case 'title':
        $sortBy = 'p.title ASC';
        break;
    case 'newest':
    default:
        $sortBy = 'p.id DESC';
        break;
}

$products = $conn->query("SELECT p.* FROM products p WHERE $where ORDER BY $sortBy");
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($category['name']); ?> | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script>
</head>
<body>
<?php include 'header.php'; ?>
<main>
    <section class="section">
        <div class="section-heading">
            <div>
                <h2><?php echo htmlspecialchars($category['name']); ?></h2>
                <p>Browse all products in this category.</p>
            </div>
        </div>
        <div class="category-list category-list--compact">
            <?php while ($cat = $categories->fetch_assoc()) { ?>
                <a href="category.php?id=<?php echo $cat['id']; ?>" class="category-pill<?php echo $cat['id'] === $id ? ' active' : ''; ?>"><?php echo htmlspecialchars($cat['name']); ?></a>
            <?php } ?>
        </div>
    </section>

    <section class="section filter-section">
        <form class="filter-form" method="GET" action="category.php">
            <input type="hidden" name="id" value="<?php echo $id; ?>">
            <div class="filter-row">
                <div class="filter-field">
                    <label>Search</label>
                    <input type="search" name="search" value="<?php echo htmlspecialchars($search); ?>" placeholder="Search within category">
                </div>
                <div class="filter-field">
                    <label>Sort by</label>
                    <select name="sort">
                        <option value="newest"<?php echo $sort === 'newest' ? ' selected' : ''; ?>>Newest</option>
                        <option value="price_asc"<?php echo $sort === 'price_asc' ? ' selected' : ''; ?>>Price: Low to High</option>
                        <option value="price_desc"<?php echo $sort === 'price_desc' ? ' selected' : ''; ?>>Price: High to Low</option>
                        <option value="title"<?php echo $sort === 'title' ? ' selected' : ''; ?>>Title A–Z</option>
                    </select>
                </div>
            </div>
            <div class="filter-actions">
                <button type="submit">Apply</button>
                <a class="reset-link" href="category.php?id=<?php echo $id; ?>">Reset</a>
            </div>
        </form>
    </section>

    <section class="section products-section">
        <?php if ($products && $products->num_rows > 0) { ?>
            <div class="products-grid">
                <?php while ($row = $products->fetch_assoc()) { ?>
                    <article class="product-card">
                        <a class="product-link" href="product.php?id=<?php echo $row['id']; ?>">
                            <div class="product-image">
                                <img src="uploads/<?php echo htmlspecialchars($row['image']); ?>" alt="<?php echo htmlspecialchars($row['title']); ?>">
                            </div>
                            <div class="product-body">
                                <h3><?php echo htmlspecialchars($row['title']); ?></h3>
                                <p class="product-description"><?php echo htmlspecialchars(substr($row['description'], 0, 90)); ?>...</p>
                                <div class="product-footer">
                                    <span class="price">UGX <?php echo number_format($row['price']); ?></span>
                                    <span class="location">📍 <?php echo htmlspecialchars($row['location']); ?></span>
                                </div>
                                <p class="product-stock">In stock: <?php echo intval($row['quantity']); ?></p>
                            </div>
                        </a>
                        <button class="cart-action" type="button" data-id="<?php echo $row['id']; ?>" data-title="<?php echo htmlspecialchars($row['title']); ?>" data-price="<?php echo $row['price']; ?>" data-image="<?php echo htmlspecialchars($row['image']); ?>">Add to Cart</button>
                    </article>
                <?php } ?>
            </div>
        <?php } else { ?>
            <div class="empty-state">
                <h3>No products found in this category.</h3>
                <p>Try a different search or browse another category.</p>
            </div>
        <?php } ?>
    </section>
</main>
</body>
</html>