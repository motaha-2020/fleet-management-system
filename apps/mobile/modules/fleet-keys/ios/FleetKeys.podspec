Pod::Spec.new do |s|
  s.name           = 'FleetKeys'
  s.version        = '0.1.0'
  s.summary        = 'Device key in the Secure Enclave'
  s.author         = 'Fleet'
  s.homepage       = 'https://example.invalid/fleet-clock'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
