Pod::Spec.new do |s|
  s.name           = 'ElapsedClock'
  s.version        = '0.1.0'
  s.summary        = 'Monotonic time since boot.'
  s.description    = 'Monotonic time since boot, unaffected by changes to the device clock.'
  s.author         = ''
  s.homepage       = 'https://almahajja.app'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
