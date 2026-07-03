import React from 'react';
import { Image, View } from 'react-native';
import { FLY2SKY_LOGO } from '../print/logo';

// Fly2Sky logo for page headers. Uses an embedded base64 data-URI (loads identically
// on web and native — a require()'d asset renders blank in Expo Go). The mark is dark,
// so it sits on a small white pill to stay legible on the dark header background.
export default function HeaderLogo() {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Image source={{ uri: FLY2SKY_LOGO }} style={{ width: 84, height: 22 }} resizeMode="contain" />
    </View>
  );
}
