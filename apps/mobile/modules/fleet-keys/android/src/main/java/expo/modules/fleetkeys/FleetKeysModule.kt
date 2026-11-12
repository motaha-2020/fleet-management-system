package expo.modules.fleetkeys

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Device key (Architecture §6, SEC-005): an EC P-256 key pair created inside the Android Keystore
 * (StrongBox when the phone has it). The private key never leaves the hardware; the app only gets
 * the public key (SPKI, base64) and signatures (DER, base64).
 */
class FleetKeysModule : Module() {
  private val alias = "fleet.device.v1"

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun generate(strongBox: Boolean) {
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .apply { if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true) }
      .build()
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(spec)
    generator.generateKeyPair()
  }

  private fun publicKeyOrNull(): String? {
    val ks = keyStore()
    if (!ks.containsAlias(alias)) return null
    return Base64.encodeToString(ks.getCertificate(alias).publicKey.encoded, Base64.NO_WRAP)
  }

  override fun definition() = ModuleDefinition {
    Name("FleetKeys")

    // Replaces any previous key: a new activation is a new device.
    AsyncFunction("createKey") {
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
      try {
        generate(strongBox = true)
      } catch (e: Exception) {
        // StrongBoxUnavailableException (or older Android): the TEE-backed keystore is still hardware.
        if (keyStore().containsAlias(alias)) keyStore().deleteEntry(alias)
        generate(strongBox = false)
      }
      publicKeyOrNull() ?: throw IllegalStateException("key was not created")
    }

    Function("publicKey") {
      publicKeyOrNull()
    }

    AsyncFunction("sign") { message: String ->
      val entry = keyStore().getEntry(alias, null) as? KeyStore.PrivateKeyEntry
        ?: throw IllegalStateException("no device key")
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(entry.privateKey)
      signature.update(message.toByteArray(Charsets.UTF_8))
      Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    Function("deleteKey") {
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
    }
  }
}
