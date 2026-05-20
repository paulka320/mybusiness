<?php
include "db.php";

if (isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit;
}

$returnUrl = $_GET['return'] ?? 'index.php';
if (strpos($returnUrl, '://') !== false || strpos($returnUrl, '..') !== false) {
    $returnUrl = 'index.php';
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';
    $returnUrl = $_POST['return'] ?? $returnUrl;

    if ($email === '' || $password === '') {
        $errors[] = 'Enter both email and password.';
    }

    if (empty($errors)) {
        $stmt = $conn->prepare('SELECT id, name, password_hash, is_admin FROM users WHERE email = ? LIMIT 1');
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $result = $stmt->get_result();
        $user = $result->fetch_assoc();
        $stmt->close();

        if ($user && password_verify($password, $user['password_hash'])) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['user_name'] = $user['name'];
            $_SESSION['user_email'] = $email;
            $_SESSION['is_admin'] = $user['is_admin'];
            header('Location: ' . $returnUrl);
            exit;
        }

        $errors[] = 'Login failed. Please check your email and password.';
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'header.php'; ?>
<main class="section upload-section">
    <div class="section-heading">
        <h2>Login to EasyMarket</h2>
        <p>Access your orders and checkout faster.</p>
    </div>

    <?php if (!empty($errors)) { ?>
        <div class="alert alert-error">
            <ul>
                <?php foreach ($errors as $error) { ?>
                    <li><?php echo htmlspecialchars($error); ?></li>
                <?php } ?>
            </ul>
        </div>
    <?php } ?>

    <form class="product-form" method="POST" action="login.php">
        <input type="hidden" name="return" value="<?php echo htmlspecialchars($returnUrl); ?>">
        <label>Email</label>
        <input type="email" name="email" placeholder="you@example.com" value="<?php echo htmlspecialchars($_POST['email'] ?? ''); ?>" required>

        <label>Password</label>
        <input type="password" name="password" required>

        <button type="submit">Login</button>
    </form>

    <p>Don't have an account? <a href="register.php">Register here</a>.</p>
</main>
</body>
</html>