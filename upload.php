<?php
include "db.php";

if (!isset($_SESSION['user_id'])) {
    header('Location: login.php?return=upload.php');
    exit;
}

$cats = $conn->query("SELECT * FROM categories ORDER BY name");
$errors = [];
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $title = trim($_POST['title'] ?? '');
    $description = trim($_POST['description'] ?? '');
    $price = floatval($_POST['price'] ?? 0);
    $quantity = intval($_POST['quantity'] ?? 0);
    $category = intval($_POST['category'] ?? 0);
    $phone = trim($_POST['phone'] ?? '');
    $location = trim($_POST['location'] ?? '');
    $payment = trim($_POST['payment'] ?? '');

    if ($title === '') {
        $errors[] = 'Product title is required.';
    }
    if ($price <= 0) {
        $errors[] = 'Enter a valid price.';
    }
    if ($quantity < 0) {
        $errors[] = 'Quantity cannot be negative.';
    }
    if ($category === 0) {
        $errors[] = 'Select a category.';
    }

    $angleFields = [
        'front_image' => 'Front view',
        'back_image' => 'Back view',
        'left_image' => 'Left side view',
        'right_image' => 'Right side view',
        'top_image' => 'Top/bottom view'
    ];
    $uploadedImages = [];
    $allowedExtensions = ['jpg', 'jpeg', 'png', 'webp'];

    foreach ($angleFields as $fieldName => $label) {
        if (empty($_FILES[$fieldName]['name'])) {
            $errors[] = "Please upload the {$label} image.";
            continue;
        }
        if ($_FILES[$fieldName]['error'] !== UPLOAD_ERR_OK) {
            $errors[] = "There was an error uploading the {$label} image.";
            continue;
        }

        $imageExtension = strtolower(pathinfo($_FILES[$fieldName]['name'], PATHINFO_EXTENSION));
        if (!in_array($imageExtension, $allowedExtensions, true)) {
            $errors[] = 'All images must be JPG, PNG or WEBP.';
            break;
        }

        $safeName = time() . '-' . $fieldName . '-' . preg_replace('/[^A-Za-z0-9._-]/', '_', $_FILES[$fieldName]['name']);
        $uploadPath = __DIR__ . '/uploads/' . $safeName;
        if (move_uploaded_file($_FILES[$fieldName]['tmp_name'], $uploadPath)) {
            $uploadedImages[] = $safeName;
        } else {
            $errors[] = 'Unable to save one of the images. Please try again.';
            break;
        }
    }

    if (empty($errors) && count($uploadedImages) < count($angleFields)) {
        $errors[] = 'Please upload an image for each product angle.';
    }

    if (empty($errors) && !empty($uploadedImages)) {
        $mainImage = $uploadedImages[0];
        $stmt = $conn->prepare("INSERT INTO products(title, description, price, category_id, phone, location, image, payment_code, quantity, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
        $stmt->bind_param('ssdisssis', $title, $description, $price, $category, $phone, $location, $mainImage, $payment, $quantity);
        $stmt->execute();
        $productId = $stmt->insert_id;
        $stmt->close();

        $imgStmt = $conn->prepare("INSERT INTO product_images(product_id, image_path, is_main) VALUES (?, ?, ?)");
        foreach ($uploadedImages as $index => $img) {
            $isMain = ($index === 0) ? 1 : 0;
            $imgStmt->bind_param('isi', $productId, $img, $isMain);
            $imgStmt->execute();
        }
        $imgStmt->close();

        $success = 'Product uploaded successfully with ' . count($uploadedImages) . ' images and is now live on EasyMarket.';
    }
}

?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sell on EasyMarket</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script>
</head>
<body>
<?php include 'header.php'; ?>
<main class="section upload-section">
    <div class="section-heading">
        <h2>Sell a product</h2>
        <p>List your item for buyers to discover.</p>
    </div>

    <?php if (!empty($success)) { ?>
        <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
    <?php } ?>

    <?php if (!empty($errors)) { ?>
        <div class="alert alert-error">
            <ul>
                <?php foreach ($errors as $error) { ?>
                    <li><?php echo htmlspecialchars($error); ?></li>
                <?php } ?>
            </ul>
        </div>
    <?php } ?>

    <form class="product-form" method="POST" enctype="multipart/form-data">
        <label>Title</label>
        <input type="text" name="title" value="<?php echo htmlspecialchars($_POST['title'] ?? ''); ?>" placeholder="Product title" required>

        <label>Description</label>
        <textarea name="description" placeholder="Product description" required><?php echo htmlspecialchars($_POST['description'] ?? ''); ?></textarea>

        <label>Price (UGX)</label>
        <input type="number" step="0.01" name="price" value="<?php echo htmlspecialchars($_POST['price'] ?? ''); ?>" placeholder="Price" required>

        <label>Quantity</label>
        <input type="number" name="quantity" min="0" value="<?php echo htmlspecialchars($_POST['quantity'] ?? ''); ?>" placeholder="Available quantity" required>

        <label>Category</label>
        <select name="category" required>
            <option value="">Select a category</option>
            <?php while ($c = $cats->fetch_assoc()) { ?>
                <option value="<?php echo $c['id']; ?>" <?php if (isset($_POST['category']) && intval($_POST['category']) === intval($c['id'])) echo 'selected'; ?>><?php echo htmlspecialchars($c['name']); ?></option>
            <?php } ?>
        </select>

        <label>Phone</label>
        <input type="text" name="phone" value="<?php echo htmlspecialchars($_POST['phone'] ?? ''); ?>" placeholder="Seller phone" required>

        <label>Location</label>
        <input type="text" name="location" value="<?php echo htmlspecialchars($_POST['location'] ?? ''); ?>" placeholder="Location" required>

        <label>Payment Code</label>
        <input type="text" name="payment" value="<?php echo htmlspecialchars($_POST['payment'] ?? ''); ?>" placeholder="Payment code or number">

        <label>Front view image</label>
        <input type="file" name="front_image" accept="image/*" required>

        <label>Back view image</label>
        <input type="file" name="back_image" accept="image/*" required>

        <label>Left side view image</label>
        <input type="file" name="left_image" accept="image/*" required>

        <label>Right side view image</label>
        <input type="file" name="right_image" accept="image/*" required>

        <label>Top/bottom view image</label>
        <input type="file" name="top_image" accept="image/*" required>
        <p class="hint">Upload one image per view so buyers can see each side of the product clearly.</p>

        <button type="submit">Upload Product</button>
    </form>

    <div class="payment-info">
        <h3>Listing fee</h3>
        <p>Send UGX 5,000 to the following mobile money details before uploading your product.</p>
        <p><strong>MTN:</strong> +256 763480495</p>
        <p><strong>AIRTEL:</strong> +256 741257369</p>
    </div>
</main>
</body>
</html>