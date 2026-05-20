<?php
include "db.php";

if (isset($_SESSION['user_id']) && isset($_SESSION['is_admin']) && $_SESSION['is_admin'] == 1) {
    header('Location: admin_dashboard.php');
    exit;
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';

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

        if ($user && password_verify($password, $user['password_hash']) && $user['is_admin'] == 1) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['user_name'] = $user['name'];
            $_SESSION['user_email'] = $email;
            $_SESSION['is_admin'] = 1;
            header('Location: admin_dashboard.php');
            exit;
        }

        $errors[] = 'Invalid admin credentials.';
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login | EasyMarket</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'header.php'; ?>
<main class="section upload-section">
    <div class="section-heading">
        <h2>Admin Login</h2>
        <p>Login to manage products.</p>
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

    <form class="product-form" method="POST" action="admin_login.php">
        <label>Email</label>
        <input type="email" name="email" placeholder="you@example.com" value="<?php echo htmlspecialchars($_POST['email'] ?? ''); ?>" required>

        <label>Password</label>
        <input type="password" name="password" required>

        <button type="submit">Login as Admin</button>
    </form>
</main>
</body>
</html>