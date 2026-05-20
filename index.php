<?php
include "db.php";

$categories = $conn->query("SELECT * FROM categories ORDER BY name");
$search = trim($_GET['search'] ?? '');
$categorySelected = intval($_GET['category_id'] ?? 0);
$minPrice = floatval($_GET['price_min'] ?? 0);
$maxPrice = floatval($_GET['price_max'] ?? 0);
$sort = $_GET['sort'] ?? 'newest';
$where = "p.approved = 1 AND p.quantity > 0";

if ($search !== '') {
    $safeSearch = $conn->real_escape_string($search);
    $where .= " AND (p.title LIKE '%$safeSearch%' OR p.description LIKE '%$safeSearch%' OR p.location LIKE '%$safeSearch%')";
}

if ($categorySelected > 0) {
    $where .= " AND p.category_id = " . $categorySelected;
}

if ($minPrice > 0) {
    $where .= " AND p.price >= " . $minPrice;
}

if ($maxPrice > 0 && $maxPrice >= $minPrice) {
    $where .= " AND p.price <= " . $maxPrice;
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

$products = $conn->query("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE $where ORDER BY $sortBy");
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EasyMarket | Buy & Sell in Uganda</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script>
</head>
<body>
<?php include 'header.php'; ?>
<main>
    <section class="hero section">
        <div class="hero-copy">
            <span class="eyebrow">Shop with confidence</span>
            <h1>Discover the best deals across Uganda</h1>
            <p>Search phones, fashion, electronics, home appliances and more from trusted sellers.</p>
            <form class="hero-search" method="GET" action="index.php">
                <input type="search" name="search" value="<?php echo htmlspecialchars($search); ?>" placeholder="Search products, brands or categories">
                <button type="submit">Search</button>
            </form>
        </div>
        <div class="hero-image"></div>
    </section>

    <section class="section categories-section">
        <div class="section-heading">
            <h2>Shop by Category</h2>
        </div>
        <div class="category-list">
            <?php while ($cat = $categories->fetch_assoc()) { ?>
                <a href="category.php?id=<?php echo $cat['id']; ?>" class="category-pill<?php echo $categorySelected === intval($cat['id']) ? ' active' : ''; ?>"><?php echo htmlspecialchars($cat['name']); ?></a>
            <?php } ?>
        </div>
    </section>

    <section class="section filter-section">
        <form class="filter-form" method="GET" action="index.php">
            <div class="filter-row">
                <div class="filter-field">
                    <label>Category</label>
                    <select name="category_id">
                        <option value="">All categories</option>
                        <?php foreach ($conn->query("SELECT * FROM categories ORDER BY name") as $cat) { ?>
                            <option value="<?php echo $cat['id']; ?>"<?php echo $categorySelected === intval($cat['id']) ? ' selected' : ''; ?>><?php echo htmlspecialchars($cat['name']); ?></option>
                        <?php } ?>
                    </select>
                </div>
                <div class="filter-field">
                    <label>Min price</label>
                    <input type="number" name="price_min" min="0" value="<?php echo $minPrice > 0 ? $minPrice : ''; ?>" placeholder="0">
                </div>
                <div class="filter-field">
                    <label>Max price</label>
                    <input type="number" name="price_max" min="0" value="<?php echo $maxPrice > 0 ? $maxPrice : ''; ?>" placeholder="0">
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
                <button type="submit">Apply filters</button>
                <a class="reset-link" href="index.php">Reset</a>
            </div>
        </form>
    </section>

    <section class="section products-section">
        <div class="section-heading">
            <h2><?php echo $search !== '' ? 'Search results for "' . htmlspecialchars($search) . '"' : 'Latest Deals'; ?></h2>
        </div>

        <?php if ($products && $products->num_rows > 0) { ?>
            <div class="products-grid">
                <?php while ($row = $products->fetch_assoc()) { ?>
                    <article class="product-card">
                        <a class="product-link" href="product.php?id=<?php echo $row['id']; ?>">
                            <div class="product-image">
                                <img src="uploads/<?php echo htmlspecialchars($row['image']); ?>" alt="<?php echo htmlspecialchars($row['title']); ?>">
                            </div>
                            <div class="product-body">
                                <p class="product-category"><?php echo htmlspecialchars($row['category_name'] ?: 'General'); ?></p>
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
                <h3>No products found.</h3>
                <p>Try another keyword or browse a category.</p>
            </div>
        <?php } ?>
    </section>
</main>
</body>
</html>