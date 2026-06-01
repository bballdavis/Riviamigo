use crate::{db::users::UserRole, errors::AppError};

pub fn parse_role(raw: &str) -> Result<UserRole, AppError> {
    UserRole::from_str(raw).ok_or_else(|| {
        AppError::Validation("role must be one of super_user, admin, or user".into())
    })
}

pub fn parse_membership_role(raw: &str) -> Result<&str, AppError> {
    if matches!(raw, "owner" | "manager" | "viewer") {
        Ok(raw)
    } else {
        Err(AppError::Validation(
            "membership role must be owner, manager, or viewer".into(),
        ))
    }
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = argon2::Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|ph| ph.to_string())
        .map_err(|_| AppError::Validation("invalid password".into()))
}

#[cfg(test)]
mod tests {
    use super::{hash_password, parse_membership_role, parse_role};
    use crate::{db::users::UserRole, errors::AppError};

    #[test]
    fn parse_role_accepts_expected_values() {
        assert_eq!(parse_role("super_user").unwrap(), UserRole::SuperUser);
        assert_eq!(parse_role("admin").unwrap(), UserRole::Admin);
        assert_eq!(parse_role("user").unwrap(), UserRole::User);
    }

    #[test]
    fn parse_role_rejects_unknown_values() {
        let err = parse_role("root").unwrap_err();
        match err {
            AppError::Validation(msg) => {
                assert!(msg.contains("role must be one of super_user, admin, or user"))
            }
            _ => panic!("expected validation error"),
        }
    }

    #[test]
    fn parse_membership_role_accepts_expected_values() {
        assert_eq!(parse_membership_role("owner").unwrap(), "owner");
        assert_eq!(parse_membership_role("manager").unwrap(), "manager");
        assert_eq!(parse_membership_role("viewer").unwrap(), "viewer");
    }

    #[test]
    fn parse_membership_role_rejects_unknown_values() {
        let err = parse_membership_role("editor").unwrap_err();
        match err {
            AppError::Validation(msg) => {
                assert!(msg.contains("membership role must be owner, manager, or viewer"))
            }
            _ => panic!("expected validation error"),
        }
    }

    #[test]
    fn hash_password_returns_argon2_hash() {
        let hash = hash_password("super-strong-password").unwrap();
        assert!(hash.starts_with("$argon2"));
        assert!(hash.len() > 30);
    }
}
