import ExpoModulesCore
import Security

// Device key in the Secure Enclave (P-256). The driver app ships on Android first; this iOS side is
// written to the same contract but has not been run on a device yet.
public class FleetKeysModule: Module {
  private let tag = "fleet.device.v1".data(using: .utf8)!
  // SubjectPublicKeyInfo header for an uncompressed P-256 point, so iOS returns the same format as Android.
  private let spkiHeader: [UInt8] = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
                                     0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00]

  private func find() -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let key = item else { return nil }
    return (key as! SecKey)
  }

  private func delete() {
    let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag]
    SecItemDelete(query as CFDictionary)
  }

  private func spki(_ privateKey: SecKey) -> String? {
    guard let pub = SecKeyCopyPublicKey(privateKey),
          let raw = SecKeyCopyExternalRepresentation(pub, nil) as Data? else { return nil }
    return (Data(spkiHeader) + raw).base64EncodedString()
  }

  public func definition() -> ModuleDefinition {
    Name("FleetKeys")

    AsyncFunction("createKey") { () -> String in
      self.delete()
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, nil) else {
        throw Exception(name: "KeyError", description: "access control")
      }
      let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: self.tag,
          kSecAttrAccessControl as String: access,
        ],
      ]
      var error: Unmanaged<CFError>?
      guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error), let out = self.spki(key) else {
        throw Exception(name: "KeyError", description: "could not create the device key")
      }
      return out
    }

    Function("publicKey") { () -> String? in
      guard let key = self.find() else { return nil }
      return self.spki(key)
    }

    AsyncFunction("sign") { (message: String) -> String in
      guard let key = self.find() else { throw Exception(name: "KeyError", description: "no device key") }
      var error: Unmanaged<CFError>?
      guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, Data(message.utf8) as CFData, &error) as Data? else {
        throw Exception(name: "KeyError", description: "sign failed")
      }
      return sig.base64EncodedString()
    }

    Function("deleteKey") {
      self.delete()
    }
  }
}
